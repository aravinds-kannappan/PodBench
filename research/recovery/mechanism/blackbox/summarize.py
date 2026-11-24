"""Compute paired descriptive deltas, preserving the case, world and checkpoint."""
import argparse
import collections
import json
from pathlib import Path
from probes import DESIGN, HERE, PLACEBOS, jobs, panel


def metric(pairs):
    n = len(pairs)
    control = sum(int(a) for a,_ in pairs)
    treatment = sum(int(b) for _,b in pairs)
    gained = sum(not a and b for a,b in pairs)
    lost = sum(a and not b for a,b in pairs)
    return {"n":n,"control":control,"treatment":treatment,"gained":gained,"lost":lost,
            "delta_pp":round(100*(treatment-control)/n,3) if n else None}


def compare(pairs):
    first = sorted({r["first_action"] or "inference_error" for pair in pairs for r in pair})
    result = {"n":len(pairs),
              "error_pairs":sum(any(r["status"]=="inference_error" for r in pair) for pair in pairs)}
    result["first_actions"] = {action:metric([((a["first_action"] or "inference_error")==action,
                                                (b["first_action"] or "inference_error")==action) for a,b in pairs])
                               for action in first}
    for field in ("submitted","passed","exact_state","inspection_seen"):
        result[field] = metric([(a[field],b[field]) for a,b in pairs])
    exposed = [(a,b) for a,b in pairs if a["inspection_seen"] and b["inspection_seen"]]
    result["submit_after_inspect"] = metric([(a["after_inspection"]=="submit",b["after_inspection"]=="submit") for a,b in exposed])
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory",required=True,type=Path)
    args=p.parse_args()
    out=args.directory
    traces=[json.loads(line) for line in (out/"traces.jsonl").read_text().splitlines()]
    decisions={r["key"]:r for r in (json.loads(line) for line in (out/"decisions.jsonl").read_text().splitlines())}
    expected={(m,t,s,c,v.id) for m in DESIGN["models"] for t,s,c,v,perm in jobs(m)}
    observed={(r["model"],r["task"],r["seed"],r["committed"],r["variant"]):r for r in traces}
    if len(observed)!=len(traces) or set(observed)!=expected:
        raise ValueError("Trace coverage differs from the declared grid")
    panel_rows=[r for r in traces if r["family"]!="permutation"]
    def matched(row, control=None):
        return observed[row["model"],row["task"],row["seed"],row["committed"],control or row["control"]]
    variants=[]
    for v in panel():
        cases=[r for r in panel_rows if r["variant"]==v.id]
        pairs=[(matched(r),r) for r in cases]
        entry={"id":v.id,"family":v.family,"label":v.label,"control":v.control,**compare(pairs),
               "by_model":{m:compare([(a,b) for a,b in pairs if b["model"]==m]) for m in DESIGN["models"]}}
        if v.id.startswith("paraphrase_"):
            alt=[(matched(r,"clean"),r) for r in cases]
            entry["vs_generic"]=compare(alt)
            for a,b in pairs:
                card=PLACEBOS[b["model"]][int(v.id[-2:])-1]
                if len(card["active"])!=len(card["placebo"]):
                    raise ValueError("Character placebo mismatch")
                if a["steps"] and b["steps"]:
                    x=decisions[a["steps"][0]["decision"]]["completion"]["input_tokens"]
                    y=decisions[b["steps"][0]["decision"]]["completion"]["input_tokens"]
                    if x!=y:raise ValueError(f"Rendered input token mismatch: {a['id']}, {b['id']}, {x}, {y}")
        variants.append(entry)
    orders=[]
    for r in traces:
        if r["family"]=="permutation":
            a=matched(r)
            orders.append({"model":r["model"],"task":r["task"],"menu":r["menu"],"id":r["id"],
                           "control":a["id"],"n":1,"first_action":r["first_action"],"submitted":r["submitted"],
                           "exact_state":r["exact_state"],"passed":r["passed"],"delta":compare([(a,r)])})
    order_summaries = []
    for task in DESIGN["permutation_tasks"]:
        grid = [r for r in orders if r["task"] == task]
        splits = {"all": grid}
        for name in grid[0]["menu"]:
            splits[name] = [r for r in grid if r["menu"][0] == name]
        for first, cells in splits.items():
            order_summaries.append({
                "model": DESIGN["permutation_model"], "task": task, "first_menu_entry": first,
                "orders": len(cells), "first_actions": dict(collections.Counter(r["first_action"] for r in cells)),
                "chose_first_entry": sum(r["first_action"] == r["menu"][0] for r in cells),
                "submitted": sum(r["submitted"] for r in cells),
                "exact_state": sum(r["exact_state"] for r in cells), "passed": sum(r["passed"] for r in cells),
            })
    requests=sum(s["decision"] is not None for r in traces for s in r["steps"])
    sources=collections.Counter("archived" if r["original_episode_turn"] else "new" for r in decisions.values())
    result={"design":DESIGN,"coverage":{"episodes":len(traces),"permutations":len(orders),"non_permutation":len(panel_rows),
            "model_decisions":requests,"unique_decisions":len(decisions),"unique_from_parent":sources["archived"],
            "new_inferences":sources["new"],"shared_decisions":requests-len(decisions),
            "inference_errors":sum(r["status"]=="inference_error" for r in traces)},
            "variants":variants,"permutations":orders,"permutation_summaries":order_summaries}
    (out/"results.json").write_text(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n")


if __name__=="__main__":
    main()
