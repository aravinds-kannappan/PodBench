"""Audit the published white-box summaries, held-out labels and intervention outcomes offline."""
from collections import Counter
import hashlib
import itertools
import json
import math
from pathlib import Path

from contexts import HERE, RecoveryEpisode, archive, examples


def load_lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def require(test, message):
    if not test:
        raise ValueError(message)


def verify_model(m, layers):
    folder=HERE/"records"/m["id"]
    for name, digest in m["artifacts"].items():
        require(hashlib.sha256((folder/name).read_bytes()).hexdigest()==digest, f"Unexpected bytes: {name}")
    read=load_lines(folder/"readouts.jsonl")
    src=examples(archive(m["id"]))
    require(len(src)==len(read)==m["n_contexts"], "Teacher-forced sample coverage")
    for r,e in zip(read,src,strict=True):
        require(all(r[k]==e[k] for k in ("id","turn","seed","inspected","target","action")), "Reference label differs")
        require(all(len(v)==len(e["menu"]) for v in r["candidate_logits"]) and len(r["lens_top"])==layers,"Invalid layer/menu shape")
    vocab=load_lines(folder/"vocab-lens.jsonl")
    require({r["context_sha256"] for r in vocab}=={r["context_sha256"] for r in read},"Missing unrestricted lens contexts")
    freq=Counter(r["context_sha256"] for r in read)
    for r in vocab:
        require(freq[r["context_sha256"]]==r["decisions"] and len(r["layers"])==layers,"Unrestricted lens coverage differs")
    lens=m["lens"]
    for l,d in enumerate(lens):
        hits=sum(r["decisions"]*(r["layers"][l]["top_token_id"]==r["layers"][-1]["top_token_id"]) for r in vocab)
        require(math.isclose(hits/len(read),d["vocab_final_agreement"]),"Unrestricted agreement differs")
        top=[r["lens_top"][l] for r in read]
        require(dict(Counter(top))==d["top_action_counts"] and d["n"]==len(read),"Lens counts differ")
        require(math.isclose(d["final_layer_agreement"],sum(a==r["lens_top"][-1] for a,r in zip(top,read))/len(read)), "Lens score differs")
    key={"hidden_commit":"committed","inspected":"inspected","correct_next_action":"target","instruction":"instruction"}
    pred=load_lines(folder/"predictions.jsonl")
    require(len(pred)==len(m["probes"])==4*layers, "Incomplete residual probes")
    for p,d in zip(pred,m["probes"],strict=True):
        expected={(r["id"],r["turn"]):str(r[key[d["target"]]]) for r in read if r["seed"]==53 and r[key[d["target"]]] is not None}
        actual={(e,i):y for e,i,y,a,b in p["test"]}
        require(actual==expected and len(p["test"])==d["test_n"],"Held-out labels or split differ")
        for col,field in [(3,"accuracy"),(4,"shuffled_accuracy")]:
            require(math.isclose(sum(r[2]==r[col] for r in p["test"])/len(actual),d[field]),"Probe score differs")
    patch=load_lines(folder/"patches.jsonl")
    require(len(patch)==6*3*layers, "Patch coverage differs")
    for d in m["patching"]:
        g=[r for r in patch if (r["layer"],r["component"])==(d["layer"],d["component"])]
        discord=[r for r in g if r["generic_top_action_token"]!=r["donor_top_action_token"]]
        decoded=[r for r in g if r["full_pair"]]
        require(len(g)==d["n"]==6 and len(discord)==d["discordant_leaders"],"Invalid patch denominator")
        require(sum(r["patched_top_action_token"]==r["donor_top_action_token"] for r in discord)==d["moved_to_donor"],"Rank patch differs")
        require(len(decoded)==d["full_reply_pairs"] and sum(r["patched_reply"].strip()==r["donor_reply"].strip() for r in decoded)==d["moved_to_donor_action"],"Reply patch differs")
    eps=load_lines(folder/"steering-episodes.jsonl")
    expected=set(itertools.product((-1,0,0.5,1,2),("refund","inventory","transfer"),(False,True),("canonical","reversed")))
    observed={(r["coefficient"],r["task"],r["committed"],r["menu_order"]) for r in eps}
    require(observed==expected and len(eps)==len(observed),"Unbalanced dose grid")
    for r in eps:
        require(r["seed"]==53 and r["instruction"]=="baseline" and 1<=len(r["steps"])<=5, "Steering control or budget differs")
        env=RecoveryEpisode(r["task"],53,r["committed"])
        try:
            for step in r["steps"]:
                action=step["reply"].strip()
                parsed=action if action in env.actions else None
                require(parsed==step["action"] and step["valid"]==(parsed is not None),"Steering parse differs")
                require((env.step(parsed) if parsed else None)==step["observation"],"Steering observation differs")
            require(env.verify()==r["verdict"],"Steering verdict differs")
        finally:
            env.close()
    for d in m["steering"]:
        g=[r for r in eps if r["coefficient"]==d["coefficient"]]
        counts=[len(g),sum(r["steps"][0]["action"]=="inspect" for r in g),sum(r["verdict"]["submitted"] for r in g),
                sum(all(r["verdict"]["endpoints"].values()) for r in g),sum(r["verdict"]["passed"] for r in g)]
        require(counts==[d[k] for k in ("n","inspect_first","submitted","exact_state","passed")],"Dose outcomes differ")
    print(f"{m['id']}: checked {len(read)} decision records, {len(patch)} patches and {len(eps)} SQLite rollouts")


if __name__=="__main__":
    data=json.loads((HERE/"results.json").read_text())
    for model in data["models"]:
        verify_model(model, {"qwen2.5-0.5b":24,"smollm2-360m":32}[model["id"]])
