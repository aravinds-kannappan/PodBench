"""Held-out linear readouts, logit lens, span attention and HF/GGUF comparisons."""
from collections import Counter
import json
import hashlib
import math
from pathlib import Path
import numpy as np
from contexts import HERE


def mean(values):
    return float(np.mean(values)) if len(values) else None


def probe_layer(x, y, train, test, shuffle):
    source, target = x[train], x[test]
    # Train-only centering and per-feature scaling, regularized dual ridge classifier.
    mu, sd = source.mean(0), source.std(0).clip(min=1e-6)
    source = ((source-mu)/sd)/math.sqrt(x.shape[1])
    target = ((target-mu)/sd)/math.sqrt(x.shape[1])
    labels = sorted(set(y[train]))
    onehot = np.column_stack([y[train]==label for label in labels]).astype(float)
    both = np.column_stack([onehot, onehot[shuffle]])
    intercept = both.mean(0)
    kernel = source @ source.T + np.eye(len(train))
    coef = np.linalg.solve(kernel, both-intercept)
    scores = (target @ source.T) @ coef + intercept
    pred = np.array(labels)[scores[:,:len(labels)].argmax(1)]
    ctrl = np.array(labels)[scores[:,len(labels):].argmax(1)]
    return pred,ctrl


def linear_probes(rows, states):
    x = np.stack([states[r["context_sha256"]]["residual"].float().numpy() for r in rows])
    return fit_probes(rows, x)


def fit_probes(rows, x):
    split = np.array([r["seed"]!=53 for r in rows])
    output=[]
    per_test=[]
    targets = {"hidden_commit":"committed","inspected":"inspected","correct_next_action":"target","instruction":"instruction"}
    for index,(name,key) in enumerate(targets.items()):
        y = np.array([str(r[key]) if r[key] is not None else "" for r in rows])
        tr = np.flatnonzero(split & (y!=""))
        te = np.flatnonzero(~split & (y!=""))
        shuffle = np.random.default_rng(41817+index).permutation(len(tr))
        majority = Counter(y[tr]).most_common(1)[0][0]
        for layer in range(x.shape[1]):
            pred,ctrl = probe_layer(x[:,layer],y,tr,te,shuffle)
            correct = pred==y[te]
            groups={}
            for group,mask in {"first_turn":[rows[i]["turn"]==1 for i in te],
                               "after_inspection":[rows[i]["inspected"] for i in te]}.items():
                groups[group]={"n":sum(mask),"accuracy":mean(correct[mask])}
            output.append({"target":name,"layer":layer+1,"train_n":len(tr),"test_n":len(te),
                           "accuracy":mean(correct),"shuffled_accuracy":mean(ctrl==y[te]),
                           "majority_accuracy":mean(majority==y[te]),"subsets":groups,
                           "test_labels":dict(Counter(y[te]))})
            per_test.append({"target":name,"layer":layer+1,"test":[
                [rows[i]["id"],rows[i]["turn"],str(y[i]),str(a),str(b)] for i,a,b in zip(te,pred,ctrl)]})
    return output,per_test


def readouts(bundle):
    rows, states = bundle["rows"],bundle["states"]
    lens, attn={},{}
    trial_rows=[]
    for r in rows:
        state=states[r["context_sha256"]]
        candidate=state["candidates"].numpy()
        labels=np.array(r["menu"])
        leaders=labels[candidate.argmax(1)].tolist()
        margins=np.sort(candidate,axis=1)
        margins=margins[:,-1]-margins[:,-2]
        for l, top in enumerate(leaders,1):
            rec = lens.setdefault(l,{"top":[],"match":[],"margin":[],"logged":[],"target":[]})
            rec["top"].append(top)
            rec["match"].append(top==leaders[-1])
            rec["margin"].append(float(margins[l-1]))
            if r["action"] is not None: rec["logged"].append(top==r["action"])
            if r["target"] is not None: rec["target"].append(top==r["target"])
        for span, stats in state["masses"].items():
            for l, mass in enumerate(stats["mass"],1):
                rec=attn.setdefault((l,span),{"mass":[],"chance":[]})
                rec["mass"].append(mass)
                rec["chance"].append(stats["fraction"])
        trial_rows.append({k:r[k] for k in ("id","turn","task","seed","instruction","inspected","committed","target",
                                              "context_sha256","menu","action")} |
                          {"lens_top":leaders,"candidate_logits":candidate.tolist(),"attention":state["masses"]})
    return (
        [{"layer":l,"n":len(s["top"]),"top_action_counts":dict(Counter(s["top"])),
          "final_layer_agreement":mean(s["match"]),"mean_margin":mean(s["margin"]),
          "archived_action_agreement":mean(s["logged"]),"archived_action_n":len(s["logged"]),
          "reference_action_agreement":mean(s["target"]),"reference_action_n":len(s["target"])} for l,s in sorted(lens.items())],
        [{"layer":l,"span":span,"n":len(s["mass"]),"mean_mass":mean(s["mass"]),
          "mean_uniform_mass":mean(s["chance"])} for (l,span),s in sorted(attn.items())],
        trial_rows
    )


def agreement(bundle):
    scores_file=HERE.parent/"scores-decisions.jsonl"
    scores = {(r["episode_id"],r["turn"]):r for line in scores_file.read_text().splitlines() if
              (r:=json.loads(line))["model"]==bundle["model"]}
    unique={}
    for r in bundle["rows"]:
        if r["turn"]==1 and r["seed"]==53:
            unique.setdefault(r["context_sha256"],r)
    pairs=[]
    for key,r in unique.items():
        s=bundle["states"][key]
        hf=bundle["decoded"][key]
        hf_action=hf.strip() if hf.strip() in r["menu"] else None
        ref=scores[r["id"],1]
        candidate=ref["candidates"]["inspect"]
        if candidate["token_ids"][0]!=s["inspect_id"] or ref["prefix_tokens"]!=s["input_tokens"]:
            raise ValueError("Model tokenization mismatch for "+r["id"])
        pairs.append({"id":r["id"],"hf_reply":hf,"gguf_reply":r["reply"],"hf_action":hf_action,
                      "gguf_action":r["action"],"first_token_id":s["inspect_id"],"hf_p":s["inspect_p"],
                      "gguf_p":math.exp(candidate["token_logprobs"][0]),
                      "hf_top_token":s["vocab_argmax"],"gguf_top_token":ref["top_tokens"][0]["id"]})
    valid=[x for x in pairs if x["hf_action"] is not None and x["gguf_action"] is not None]
    matched=sum(x["hf_action"]==x["gguf_action"] for x in valid)
    return {"gguf_scores_sha256":hashlib.sha256(scores_file.read_bytes()).hexdigest(),
            "total":len(pairs),"action_agreement_all":matched/len(pairs),
            "action_agreement_if_both_parsed":matched/len(valid) if valid else None,"exact_replies":sum(x["hf_reply"]==x["gguf_reply"] for x in pairs),
            "first_token_matches":sum(x["hf_top_token"]==x["gguf_top_token"] for x in pairs),
            "hf_invalid":sum(x["hf_action"] is None for x in pairs),"gguf_invalid":sum(x["gguf_action"] is None for x in pairs),
            "paired_valid":len(valid),"matched_actions":matched,
            "inspect_mean_abs_probability_difference":mean([abs(x["hf_p"]-x["gguf_p"]) for x in pairs]),
            "pairs":pairs}
