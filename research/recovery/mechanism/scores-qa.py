"""Build independent cold-branch controls and compare unrounded numerical measurements."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from statistics import fmean

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("scores_inputs", HERE / "scores-inputs.py")
inputs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inputs)


def read(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def source(swaps=False):
    return [r for e in read(HERE.parent / "episodes.jsonl") for r in inputs.requests(e, swaps)]


def key(row):
    return row["episode_id"], row["turn"]


def signature(row):
    return row["model"], json.dumps(row["messages"], sort_keys=True), tuple(row["menu"])


def controls():
    all_rows = source()
    for model in ("qwen2.5-0.5b","smollm2-360m"):
        for task in ("refund","inventory","transfer"):
            group = [r for r in all_rows if (r["model"],r["task"])==(model,task)]
            yield next(r for r in group if r["turn"]==1)
            yield max(group, key=lambda r: r["input_tokens"])


def change(a,b):
    values = [(a["candidates"][act],b["candidates"][act]) for act in a["candidates"]]
    if any(v["token_ids"] != w["token_ids"] for v,w in values):
        raise ValueError("Compared action tokenizations differ")
    top_a = {t["id"]:t["probability"] for t in a["top_tokens"]}
    top_b = {t["id"]:t["probability"] for t in b["top_tokens"]}
    return {"tv":sum(abs(v["menu_probability"]-w["menu_probability"]) for v,w in values)/2,
            "max_abs_token_logprob_delta":max(abs(i-j) for v,w in values
                                              for i,j in zip(v["token_logprobs"],w["token_logprobs"],strict=True)),
            "max_abs_sequence_logprob_delta":max(abs(v["logprob"]-w["logprob"]) for v,w in values),
            "top_ten_order_changed":tuple(top_a) != tuple(top_b),
            "max_shared_top_ten_probability_delta":max((abs(top_a[t]-top_b[t]) for t in top_a.keys() & top_b.keys()), default=0),
            "top_action_changed":a["top_action"] != b["top_action"]}


def summarize(diffs):
    return {"n":len(diffs),"mean_tv":fmean(d["tv"] for d in diffs),"max_tv":max(d["tv"] for d in diffs),
            "max_abs_token_logprob_delta":max(d["max_abs_token_logprob_delta"] for d in diffs),
            "max_abs_sequence_logprob_delta":max(d["max_abs_sequence_logprob_delta"] for d in diffs),
            "top_ten_order_changes":sum(d["top_ten_order_changed"] for d in diffs),
            "max_shared_top_ten_probability_delta":max(d["max_shared_top_ten_probability_delta"] for d in diffs),
            "top_action_changes":sum(d["top_action_changed"] for d in diffs)}


def replicate_check(observed, swaps, branches=()):
    by_id = {key(r):r for r in observed}
    by_prefix = {signature(r):by_id[key(r)] for r in source()}
    swapped = {key(r):r for r in swaps}
    encoded = {}
    for model in ("qwen2.5-0.5b","smollm2-360m"):
        equal = [(by_prefix[signature(r)],swapped[key(r)]) for r in source(True) if r["model"]==model and signature(r) in by_prefix]
        metrics = {"identical_observed_and_swapped_inputs":summarize([change(a,b) for a,b in equal])}
        if branches:
            independent = [r for r in branches if r["model"]==model]
            if len(independent) != 6:
                raise ValueError("Expected six independent full branch resets per checkpoint")
            metrics["full_reset_each_candidate"] = summarize([change(r,by_id[key(r)]) for r in independent])
        encoded[model]=metrics
    return encoded


def superseded_report(directory):
    """Summarize the historical measurements made with cross-prompt KV reuse."""
    files = {name:directory / name for name in ("scores-decisions.jsonl", "scores-swaps.jsonl", "scores-summary.json")}
    observed = read(files["scores-decisions.jsonl"])
    swaps = read(files["scores-swaps.jsonl"])
    old_summary = json.loads(files["scores-summary.json"].read_text())
    primary_ids = {key(r):r for r in observed}
    by_prefix = {signature(r):primary_ids[key(r)] for r in source()}
    swapped = {key(r):r for r in swaps}
    controls = []
    for req in source(True):
        original = by_prefix.get(signature(req))
        if original is None:
            continue
        other = swapped[key(req)]
        encoded = json.dumps(req["messages"],sort_keys=True,separators=(",",":")).encode()
        controls.append({"model":req["model"], "original":list(key(original)), "swap":list(key(other)),
                         "visible_prefix_sha256":hashlib.sha256(encoded).hexdigest(), **change(original,other)})
    by_arm = {}
    for r in old_summary["conditions"]:
        by_arm.setdefault(r["model"], {})[r["instruction"]] = {
            k:r["post_inspect"].get(k) for k in ("n","top_flips","mean_tv","max_tv")}
    return {"status":"Superseded warm-prefix pass, numerical audit only", "scorer_commit":"1ff3f95",
            "inputs":{name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in files.items()},
            "repeat_controls":replicate_check(observed,swaps), "matched_inputs":controls,
            "superseded_swap_summaries":by_arm}


if __name__ == "__main__":
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--control-inputs",action="store_true")
    cli.add_argument("--decisions",type=Path,default=HERE/"scores-decisions.jsonl")
    cli.add_argument("--swaps",type=Path,default=HERE/"scores-swaps.jsonl")
    cli.add_argument("--branches",type=Path)
    cli.add_argument("--superseded", type=Path, help="directory of the archived warm decisions, swaps and summary")
    args=cli.parse_args()
    if args.superseded:
        print(json.dumps(superseded_report(args.superseded), indent=2))
    elif args.control_inputs:
        for r in controls():
            print(json.dumps(r,ensure_ascii=False))
    else:
        print(json.dumps(replicate_check(read(args.decisions),read(args.swaps),read(args.branches) if args.branches else ()),indent=2))
