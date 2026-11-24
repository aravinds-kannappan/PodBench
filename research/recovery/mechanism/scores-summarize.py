"""Descriptive comparison of fixed-action score paths and observation-only counterfactuals."""
from collections import Counter
import argparse
import json
import math
from pathlib import Path
from statistics import fmean

HERE = Path(__file__).resolve().parent
MODELS = ("qwen2.5-0.5b","smollm2-360m")
ARMS = ("baseline","inspect_first")
TASKS = ("refund","inventory","transfer")
RETRY = {"refund":"record_refund", "inventory":"receive_stock", "transfer":"archive_customer"}


def rows(name):
    return [json.loads(s) for s in (HERE / f"scores-{name}.jsonl").read_text().splitlines()]


def subset(data, **filters):
    return [r for r in data if all(r[k] == v for k, v in filters.items())]


def frequencies(data):
    return dict(Counter(r["logged_action"] or "invalid" for r in data).most_common())


def menu_means(data, joint=False):
    if not data:
        return {}
    return {a:fmean(math.exp(r["candidates"][a]["logprob"]) if joint else r["candidates"][a]["menu_probability"]
                    for r in data)
            for a in sorted(data[0]["candidates"])}


def step_counts(data):
    # Full vocabulary probabilities are archived for the top ten tokens. A token
    # outside a prefix's top ten contributes zero to its lower-bound mean here.
    lower_sum = Counter()
    first = Counter()
    shown = Counter()
    for row in data:
        first[row["top_tokens"][0]["id"]] += 1
        for t in row["top_tokens"]:
            lower_sum[t["id"]] += t["probability"]
            shown[t["id"]] += 1
    labels = {t["id"]:t["text"] for r in data for t in r["top_tokens"]}
    return {"n":len(data), "chosen":frequencies(data),
            "mean_entropy_nats":fmean(r["menu_entropy_nats"] for r in data),
            "top_first_tokens":[{"id":i, "text":labels[i], "top_one_count":first[i],
                                 "top_ten_count":shown[i], "mean_probability_lower_bound":v / len(data)}
                                for i,v in lower_sum.most_common(10)]}


def swap_counts(data):
    if not data:
        return {"n":0, "changed_inputs":0}
    changed = [r for r in data if r["observation_changed"]]
    output = {"n":len(data), "changed_inputs":len(changed), "top_flips":sum(r["flip"] for r in data),
              "mean_tv":fmean(r["tv"] for r in data), "max_tv":max(r["tv"] for r in data),
              "changed_input_mean_tv":fmean(r["tv"] for r in changed) if changed else None,
              "mean_retry_absent_minus_committed":fmean(r["retry_delta"] for r in changed) if changed else None,
              "observed_next_by_world": [{"committed":world, "n":len(group), "chosen":frequencies(group)}
                                         for world in (False,True) if (group:=subset(data,committed=world))],
              "families":{}}
    for family in TASKS:
        rr = subset(data,task=family)
        output["families"][family] = {"n":len(rr), "changed":sum(r["observation_changed"] for r in rr),
                                      "top_flips":sum(r["flip"] for r in rr),
                                      "mean_tv":fmean(r["tv"] for r in rr) if rr else None}
    return output


def build(main, swaps):
    observed = {(r["episode_id"],r["turn"]):r for r in main}
    joined = []
    for s in swaps:
        o = observed[s["episode_id"],s["turn"]]
        p = {a:v["menu_probability"] for a,v in o["candidates"].items()}
        q = {a:v["menu_probability"] for a,v in s["candidates"].items()}
        retry = RETRY[s["task"]]
        joined.append({"model":s["model"],"instruction":s["instruction"], "task":s["task"], "turn":s["turn"],
                       "episode_id":s["episode_id"], "committed":s["committed"], "logged_action":o["logged_action"],
                       "observation_changed":s["observation_changed"],
                       "logged_top":o["top_action"], "swapped_top":s["top_action"],
                       "flip":o["top_action"] != s["top_action"], "tv":sum(abs(p[a]-q[a]) for a in p)/2,
                       "retry_delta":(q[retry]-p[retry])*(1 if s["committed"] else -1)})
    result = {"study":"Exploratory (not preregistered)", "decision_count":len(main), "observation_swaps":len(swaps),
              "conditions":[], "first_step_contrasts":[], "swap_contrasts":joined}
    for m in MODELS:
        for arm in ARMS:
            data = subset(main,model=m,instruction=arm)
            first = subset(data,turn=1)
            worlds = [{"menu_order":order,"committed":world,"n":len(items),"chosen":frequencies(items)}
                      for order in ("canonical","reversed") for world in (False,True)
                      if (items:=subset(first,menu_order=order,committed=world))]
            first_families = {f:menu_means(subset(first,task=f)) for f in TASKS}
            sw = subset(joined,model=m,instruction=arm)
            result["conditions"].append({"model":m, "instruction":arm, "decisions":len(data),
                "first_n":len(first), "first_actions":frequencies(first),"first_worlds":worlds,
                "first_mean_legal_by_family":first_families,
                "first_mean_joint_by_family":{f:menu_means(subset(first,task=f), joint=True) for f in TASKS},
                "first_mean_inspect":fmean(r["candidates"]["inspect"]["menu_probability"] for r in first),
                "turns":[{"turn":t,**step_counts(subset(data,turn=t))} for t in range(1,6) if subset(data,turn=t)],
                "post_inspect":swap_counts(sw),
                "example_swap":max(sw,key=lambda r:r["tv"]) if sw else None})
        for task in TASKS:
            groups = [subset(main,model=m,task=task,turn=1,instruction=arm) for arm in ARMS]
            means = [menu_means(g) for g in groups]
            joint = [menu_means(g,joint=True) for g in groups]
            for action in means[0]:
                base, treatment = (v[action] for v in means)
                joint_base, joint_treatment = (v[action] for v in joint)
                result["first_step_contrasts"].append({"model":m,"task":task,"action":action,"n_per_arm":16,
                                                     "baseline":base,"inspect_first":treatment,"delta":treatment-base,
                                                     "joint_baseline":joint_base, "joint_inspect_first":joint_treatment,
                                                     "joint_delta":joint_treatment-joint_base})
    return result


def audit_paths(main, greedy):
    observed = {(r["episode_id"],r["turn"]):r for r in main}
    result = {}
    for m in MODELS:
        auditor = subset(greedy, model=m)
        matches = [r["greedy_path"] for r in auditor]
        comparisons = [(r["greedy_path"], observed[r["episode_id"],r["turn"]]) for r in auditor]
        shared_top = [(path, original) for path,original in comparisons
                      if path["token_ids"][0] == original["top_tokens"][0]["id"]]
        canonical_matches = [(path,o["logged_continuation"]) for path,o in comparisons
                             if path["token_ids"] == o["logged_continuation"]["token_ids"]]
        matching_deltas = [abs(i-j) for path,logged in canonical_matches
                           for i,j in zip(path["token_logprobs"],logged["token_logprobs"],strict=True)]
        result[m] = {"n":len(matches),
            "matches_score_top_one_token":len(shared_top),
            "matches_canonical_token_path":len(canonical_matches),
            "shared_path_token_count":len(matching_deltas),
            "max_abs_logprob_difference_on_shared_canonical_paths":max(matching_deltas,default=None),
            "max_abs_first_logprob_difference_on_shared_top":max(
                (abs(path["token_logprobs"][0] - math.log(o["top_tokens"][0]["probability"])) for path,o in shared_top),
                default=None),
            "matches_text":sum(p["matches_reply"] for p in matches),
            "matches_output_count":sum(p["matches_length"] for p in matches),
            "matches_termination":sum(p["matches_finish"] for p in matches),
            "matches_all":sum(p["matches_reply"] and p["matches_length"] and p["matches_finish"] for p in matches)}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", action="store_true", help="summarize the separate greedy-token reconstruction")
    args = parser.parse_args()
    if args.audit:
        summary = audit_paths(rows("decisions"), rows("greedy"))
        target = HERE / "scores-audit.json"
    else:
        summary = build(rows("decisions"), rows("swaps"))
        target = HERE / "scores-summary.json"
    target.write_text(json.dumps(summary,ensure_ascii=False,allow_nan=False,indent=2)+"\n")
