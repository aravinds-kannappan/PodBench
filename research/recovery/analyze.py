"""Replay the archived SQLite decisions and analyze the prospectively fixed recovery grid."""
import argparse
import csv
import hashlib
import itertools
import json
from pathlib import Path
import random
import statistics

from environment import RecoveryEpisode

HERE = Path(__file__).resolve().parent
DOCS = HERE.parents[1] / "docs"
MODELS = ("qwen2.5-0.5b", "smollm2-360m")
FAMILIES = ("refund", "inventory", "transfer")
SEEDS = (11, 23, 37, 53)
ARMS = ("baseline", "inspect_first")
MENUS = ("canonical", "reversed")
KEY = ("model", "task", "seed", "committed", "instruction", "menu_order")
BOOTSTRAP_SEED = 20261124
DRAWS = 10000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def schedule(models=MODELS):
    for values in itertools.product(models, FAMILIES, SEEDS, (False, True), ARMS, MENUS):
        yield dict(zip(KEY, values))


def identity(row):
    return tuple(row[field] for field in KEY)


def state_diagnostics(env, verdict):
    observed = verdict["observed"]
    endpoints = verdict["endpoints"]
    if env.task == "inventory":
        value, expected = observed["stock"], env.before_stock + env.units
        followup = endpoints["receipt_posted"]
    elif env.task == "refund":
        value, expected = len(observed["refund_amounts"]), 1
        followup = endpoints["order_refunded"]
    else:
        value, expected = len(observed["archive_emails"]), 1
        followup = endpoints["orders_moved"] and endpoints["customer_removed"]
    return {"duplicate": value > expected, "omission": value < expected,
            "incomplete_followup": not followup, "collateral": not endpoints["collateral_unchanged"]}


def replay(raw):
    """Re-execute named actions and verify tool observations and terminal SQLite state."""
    env = RecoveryEpisode(raw["task"], raw["seed"], raw["committed"])
    try:
        for turn, step in enumerate(raw["steps"], 1):
            reply = step["reply"]
            parsed = reply.strip() if isinstance(reply, str) and reply.strip() in env.actions else None
            require(step["turn"] == turn and step["action"] == parsed and step["valid"] is (parsed is not None),
                    f"{raw['id']} turn {turn}: action differs from exact-name parser")
            if step["valid"]:
                actual = env.step(step["action"])
                require(actual == step["observation"], f"{raw['id']} turn {step['turn']}: tool observation differs")
            else:
                require(not step.get("observation"), f"{raw['id']}: invalid action executed")
        verdict = env.verify()
        # SQLite row tuples are arrays on disk.
        require(json.loads(json.dumps(verdict)) == raw["verdict"], f"{raw['id']}: terminal verdict differs from replay")
        return verdict, state_diagnostics(env, verdict)
    finally:
        env.close()


def episode(design, raw=None, line=None):
    row = dict(design, id=None, trace_line=line, status="missing", passed=False, submitted=False,
               exact_state=None, first_inspection=None, valid_turns=0, invalid_turns=0, tool_errors=0,
               diagnostic_eligible=False, duplicate=None, omission=None, incomplete_followup=None,
               collateral=None, classification="missing", turns=[])
    if raw is None:
        return row
    status = raw["status"]
    require(status in ("submitted", "step_limit", "inference_error"), f"Unknown status {status}")
    steps = raw["steps"]
    require(1 <= len(steps) <= 5, f"{raw['id']}: invalid decision count")
    require(status != "step_limit" or len(steps) == 5, f"{raw['id']}: premature turn limit")
    require(all(s["action"] != "submit" and s["reply"] is not None for s in steps[:-1]),
            f"{raw['id']}: decision after a terminal turn")
    require((steps[-1]["reply"] is None) == (status == "inference_error"), f"{raw['id']}: invalid inference status")
    verdict, diagnostics = replay(raw)
    decisions = [s for s in steps if s["reply"] is not None]
    valid = [s for s in decisions if s["valid"]]
    submitted = any(s["action"] == "submit" for s in valid)
    require(submitted == verdict["submitted"] == (status == "submitted"), f"{raw['id']}: inconsistent submit")
    exact = all(verdict["endpoints"].values())
    eligible = status != "inference_error" and bool(valid)
    passed = status == "submitted" and exact
    if status == "inference_error":
        reason = "inference_error"
    elif passed:
        reason = "success"
    elif status == "submitted":
        reason = "submitted_inexact"
    elif not valid:
        reason = "no_valid_decision"
    else:
        reason = "step_limit"
    row.update(id=raw["id"], trace_line=line, status=status, submitted=submitted,
               exact_state=exact, passed=passed, classification=reason,
               first_inspection=(decisions[0]["action"] == "inspect") if decisions else None,
               invalid_turns=len(decisions)-len(valid), valid_turns=len(valid), diagnostic_eligible=eligible)
    for s in steps:
        observation = s.get("observation") or {}
        row["turns"].append({"turn": s["turn"], "reply": s["reply"], "action": s["action"],
                             "result": observation.get("result"), "error": observation.get("error")})
    row["tool_errors"] = sum(t["error"] is not None for t in row["turns"])
    if status == "inference_error" and row["turns"] and row["turns"][-1]["reply"] is None:
        row["turns"][-1]["error"] = raw.get("error", "Inference failed before a response was returned")
    if eligible:
        row.update(diagnostics)
    return row


def aggregate(rows):
    def count(field):
        return sum(r[field] is True for r in rows)
    return {
        "scheduled": len(rows), "recorded": sum(r["status"] != "missing" for r in rows),
        "passed": count("passed"), "submitted": count("submitted"), "exact_state": count("exact_state"),
        "missing": sum(r["status"] == "missing" for r in rows),
        "inference_errors": sum(r["status"] == "inference_error" for r in rows),
        "step_limit": sum(r["status"] == "step_limit" for r in rows),
        "submitted_inexact": sum(r["classification"] == "submitted_inexact" for r in rows),
        "no_valid_decision": sum(r["classification"] == "no_valid_decision" for r in rows),
        "invalid": sum(r["invalid_turns"] > 0 for r in rows), "invalid_turns": sum(r["invalid_turns"] for r in rows),
        "valid_turns": sum(r["valid_turns"] for r in rows), "tool_errors": sum(r["tool_errors"] for r in rows),
        "first_inspection": count("first_inspection"), "first_decisions": sum(r["first_inspection"] is not None for r in rows),
        "diagnostic_eligible": count("diagnostic_eligible"), "duplicate": count("duplicate"),
        "omission": count("omission"), "incomplete_followup": count("incomplete_followup"), "collateral": count("collateral"),
    }


def interval(cluster_differences):
    """Resample four clusters *within* each of three fixed task families."""
    rng = random.Random(BOOTSTRAP_SEED)
    draws = []
    for _ in range(DRAWS):
        sampled = [rng.choice(values) for values in cluster_differences for _ in values]
        draws.append(statistics.fmean(sampled))
    cut = statistics.quantiles(draws, n=1000, method="inclusive")
    return [cut[24], cut[974]]


def model_comparison(rows):
    cells = {(r["task"], r["seed"], r["committed"], r["menu_order"], r["instruction"]): r for r in rows}
    differences = []
    improved = regressed = complete = assessed = improved_assessed = regressed_assessed = 0
    for family in FAMILIES:
        seeds = []
        for seed in SEEDS:
            deltas = []
            for world, menu in itertools.product((False, True), MENUS):
                a, b = (cells[family, seed, world, menu, arm] for arm in ARMS)
                delta = int(b["passed"]) - int(a["passed"])
                deltas.append(delta)
                improved += delta == 1
                regressed += delta == -1
                complete += a["status"] != "missing" and b["status"] != "missing"
                if all(r["status"] not in ("missing","inference_error") for r in (a,b)):
                    assessed += 1
                    improved_assessed += delta == 1
                    regressed_assessed += delta == -1
            seeds.append(statistics.fmean(deltas))
        differences.append(seeds)
    arms = {arm: aggregate([r for r in rows if r["instruction"] == arm]) for arm in ARMS}
    pairs = arms["baseline"]["scheduled"]
    return {"generic": arms["baseline"]["passed"] / pairs, "verify_first": arms["inspect_first"]["passed"] / pairs,
            "by_instruction": arms, "difference": statistics.fmean(map(statistics.fmean, differences)),
            "interval": interval(differences), "clusters": sum(map(len, differences)), "pairs": pairs,
            "improvement_pairs": improved, "regression_pairs": regressed, "same_pairs": pairs - improved - regressed,
            "both_recorded_pairs": complete, "both_nonerror_pairs": assessed,
            "nonerror_improvement_pairs": improved_assessed, "nonerror_regression_pairs": regressed_assessed}


def analyze(records, model_ids=MODELS):
    if (not model_ids or any(not isinstance(m, str) or not m.strip() or m.strip() != m
                             or not m.isprintable() for m in model_ids)):
        raise ValueError("Model IDs must be nonempty printable names without surrounding whitespace")
    require(len(set(model_ids)) == len(model_ids), "Duplicate model ID")
    design = list(schedule(model_ids))
    allowed = {identity(d) for d in design}
    indexed = {}
    ids = set()
    for line, raw in enumerate(records, 1):
        key = identity(raw)
        require(type(raw["committed"]) is bool and key in allowed, f"Unscheduled trial {key}")
        require(key not in indexed and raw["id"] not in ids, f"Repeated trial {key}")
        indexed[key] = raw, line
        ids.add(raw["id"])
    rows = [episode(d, *indexed.get(identity(d), (None, None))) for d in design]
    models, cells, menus = [], [], []
    for model in model_ids:
        subset = [r for r in rows if r["model"] == model]
        models.append({"model": model, **model_comparison(subset)})
        for task, world, arm in itertools.product(FAMILIES, (False, True), ARMS):
            group = [r for r in subset if (r["task"],r["committed"],r["instruction"]) == (task,world,arm)]
            cells.append({"model": model, "family": task, "committed": world, "instruction": arm, **aggregate(group)})
        for menu, arm in itertools.product(MENUS, ARMS):
            group = [r for r in subset if r["menu_order"] == menu and r["instruction"] == arm]
            menus.append({"model": model, "menu_order": menu, "instruction": arm, **aggregate(group)})
    return {"schema_version": 1, "protocol": "research/recovery/PROTOCOL.md", "models": model_ids, "families": FAMILIES,
            "bootstrap": {"seed": BOOTSTRAP_SEED, "draws": DRAWS, "level": 0.95,
                          "method": "Percentile bootstrap of seed clusters stratified within fixed task family."},
            "totals": aggregate(rows), "by_model": models, "cells": cells, "by_menu": menus, "episodes": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journal", type=Path, default=HERE / "episodes.jsonl")
    parser.add_argument("--output", type=Path, default=DOCS / "recovery-results.json")
    parser.add_argument("--csv", type=Path, default=DOCS / "recovery-episodes.csv")
    parser.add_argument("--model-id", action="append", help="analyze this model ID in the same 96-cell design; repeat for additional models")
    args = parser.parse_args()
    source = args.journal.read_bytes()
    report = analyze((json.loads(line) for line in source.splitlines()), args.model_id or MODELS)
    report["journal_sha256"] = hashlib.sha256(source).hexdigest()
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    fields = [name for name in report["episodes"][0] if name != "turns"]
    with args.csv.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(report["episodes"])
    print(f"{report['totals']['recorded']} of {report['totals']['scheduled']} scheduled episodes replayed.")


if __name__ == "__main__":
    main()
