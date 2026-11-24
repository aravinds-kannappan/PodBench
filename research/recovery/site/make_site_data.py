"""Generate the static site datasets from the frozen release and exploratory outputs."""

import argparse
import csv
import hashlib
import itertools
import json
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from assets import apply as prepare_assets

SITE = Path(__file__).resolve().parent
REC = SITE.parent
MECH = REC / "mechanism"
ROOT = REC.parents[1]
DATA = SITE / "public/data"
LABELS = (
    "premature submit",
    "incomplete reconciliation",
    "duplicate write",
    "wrong-row write",
    "invalid-action loop",
    "no valid decision",
    "repeated-action loop",
    "exact state without submit",
)
BADGE = "Exploratory (not preregistered)"


def readjson(p):
    return json.loads(p.read_bytes())


def lines(p):
    return [json.loads(s) for s in p.read_bytes().splitlines()]


def csvdata(p):
    with p.open(newline="") as f:
        return list(csv.DictReader(f))


def as_bool(s):
    if s not in ("true", "false"):
        raise ValueError(f"Expected a Boolean, received {s!r}")
    return s == "true"


def pack(value):
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        + "\n"
    ).encode()


def group(rows, *keys):
    result = defaultdict(list)
    for r in rows:
        result[tuple(r[k] for k in keys)].append(r)
    return result


def mean(values):
    return statistics.fmean(values)


def calculate():
    journal = lines(REC / "episodes.jsonl")
    old = ROOT / "docs/recovery-results.json"
    if (
        hashlib.sha256((REC / "episodes.jsonl").read_bytes()).hexdigest()
        != readjson(old)["journal_sha256"]
    ):
        raise ValueError("Frozen journal does not match its published results")
    files = {"frozen.json": old.read_bytes()}
    per_ep = {r["id"]: r for r in csvdata(MECH / "trace_episodes.csv")}
    turns = {(r["id"], int(r["turn"])): r for r in csvdata(MECH / "decisions.csv")}
    groups, first_rows, shift_scores, per_step, cumulative, interventions, flows = (
        [],
        [],
        [],
        [],
        [],
        [],
        [],
    )
    traces, index = [], []
    for raw in journal:
        r = per_ep[raw["id"]]
        cutoff = {
            key: int(r[key]) if r[key] else None
            for key in ("first_unreachable_exact", "first_unreachable_submission")
        }
        trace = dict(
            raw,
            label=r["failure_label"],
            **cutoff,
            final_diff=json.loads(r["final_diff"]),
        )
        traces.append(trace)
        relative = f"traces/{raw['id']}.json"
        index.append(
            {
                **{
                    k: trace[k]
                    for k in (
                        "id",
                        "task",
                        "seed",
                        "model",
                        "instruction",
                        "committed",
                        "menu_order",
                        "label",
                        *cutoff,
                    )
                },
                "first_action": raw["steps"][0]["action"],
                "url": "data/" + relative,
            }
        )
        for step in trace["steps"]:
            s = turns[trace["id"], step["turn"]]
            for k in (
                "parse_succeeded",
                "claims_inspection",
                "inspected_before",
                "executed_inspect",
                "crossed_exact",
                "crossed_submission",
                "exact_reachable_after",
                "submission_reachable_after",
                "same_action_as_previous",
            ):
                step[k] = as_bool(s[k])
            for k in ("parse_failure", "top_action", "runner_up"):
                step[k] = s[k] or None
            for k in ("action_loop_period", "invalid_loop_period", "position_1based"):
                step[k] = int(s[k]) if s[k] else None
            for k in ("candidates", "top_tokens", "diff_after"):
                step[k] = json.loads(s[k])
            for k in ("menu_entropy_nats", "margin_nats", "submit_logprob"):
                step[k] = float(s[k])
            step["forcing"] = {
                p: {
                    "eligible": bool(s["force_" + p]),
                    "forced_action": s["force_" + p] or None,
                    "passed": as_bool(s[p + "_success"]) if s[p + "_success"] else None,
                }
                for p in ("oracle", "evidence")
            }
        files[relative] = pack(trace)
    for (model, arm), rs in group(traces, "model", "instruction").items():
        base = {"model": model, "instruction": arm}
        n = len(rs)
        labels = Counter(r["label"] for r in rs)
        if set(labels) - set(LABELS):
            raise ValueError("Unexpected failure label")
        all_steps = [s for r in rs for s in r["steps"]]
        groups.append(
            dict(
                **base,
                n=n,
                failures={k: labels[k] for k in LABELS},
                invalid_turns=sum(not s["valid"] for s in all_steps),
                decisions=len(all_steps),
                first_inspection=sum(r["steps"][0]["action"] == "inspect" for r in rs),
                submitted=sum(r["verdict"]["submitted"] for r in rs),
                exact_state=sum(all(r["verdict"]["endpoints"].values()) for r in rs),
                passed=sum(r["verdict"]["passed"] for r in rs),
            )
        )
        for (menu, world), sample in group(rs, "menu_order", "committed").items():
            choices = Counter(r["steps"][0]["action"] or "invalid" for r in sample)
            for action in sorted({"invalid"}.union(*(r["menu"] for r in sample))):
                first_rows.append(
                    dict(
                        **base,
                        menu_order=menu,
                        committed=world,
                        action=action,
                        count=choices[action],
                        total=len(sample),
                    )
                )
        for turn in range(1, 1 + max(s["turn"] for s in all_steps)):
            sample = [s for s in all_steps if s["turn"] == turn]
            per_step.append(
                dict(
                    **base,
                    turn=turn,
                    n=len(sample),
                    entropy_nats=mean(s["menu_entropy_nats"] for s in sample),
                    margin_nats=mean(s["margin_nats"] for s in sample),
                )
            )
            cumulative.append(
                dict(
                    **base,
                    turn=turn,
                    total=n,
                    exact_state=sum(
                        r["first_unreachable_exact"] is not None
                        and r["first_unreachable_exact"] <= turn
                        for r in rs
                    ),
                    exact_submitted=sum(
                        r["first_unreachable_submission"] is not None
                        and r["first_unreachable_submission"] <= turn
                        for r in rs
                    ),
                )
            )
            for policy in ("oracle", "evidence"):
                arms = [s["forcing"][policy] for s in sample]
                interventions.append(
                    dict(
                        **base,
                        turn=turn,
                        policy=policy,
                        total=len(arms),
                        eligible=sum(a["eligible"] for a in arms),
                        success=sum(a["passed"] is True for a in arms),
                    )
                )
        paths = Counter(
            (
                r["steps"][0]["action"] or "invalid",
                (r["steps"][1]["action"] or "invalid")
                if len(r["steps"]) > 1
                else "episode ended",
                r["label"],
            )
            for r in rs
        )
        flows.extend(
            dict(**base, first=a, second=b, terminal=c, count=count)
            for (a, b, c), count in paths.items()
        )
    for (model, task, seed), rs in group(traces, "model", "task", "seed").items():
        by_key = {
            (r["instruction"], r["committed"], r["menu_order"]): r["steps"][0][
                "candidates"
            ]
            for r in rs
        }
        for action in rs[0]["menu"]:
            deltas = []
            for w, m in itertools.product((True, False), ("canonical", "reversed")):
                a, b = (
                    by_key[(arm, w, m)][action]["menu_probability"]
                    for arm in ("baseline", "inspect_first")
                )
                deltas.append(b - a)
            shift_scores.append(
                dict(
                    model=model,
                    task=task,
                    seed=seed,
                    action=action,
                    delta=mean(deltas),
                    pairs=len(deltas),
                )
            )
    files["episodes.json"] = pack(index)
    summary = dict(
        study=BADGE,
        groups=groups,
        first_actions=first_rows,
        shifts=shift_scores,
        steps=per_step,
        deadlines=cumulative,
        forcing=interventions,
        flows=flows,
    )
    explain = readjson(MECH / "scores-summary.json")
    summary["explainer"] = explain
    files["summary.json"] = pack(summary)
    files["probes.json"] = pack(
        {k: readjson(MECH / k / "results.json") for k in ("blackbox", "whitebox")}
    )
    return files


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    prepare_assets(SITE, args.check)
    flags = ["--check"] if args.check else []
    subprocess.run(
        [sys.executable, str(MECH / "review/generate.py"), *flags], check=True
    )
    agreement = SITE / "public/review/agreement.json"
    if not agreement.exists() and not args.check:
        subprocess.run(
            [
                sys.executable,
                str(MECH / "review/agreement.py"),
                "--output",
                str(agreement),
            ],
            check=True,
        )
    kit = readjson(SITE / "public/review/kit.json")
    if readjson(agreement)["kit_id"] != kit["kit_id"]:
        sys.exit("The agreement report references a different annotation kit")
    subprocess.run(
        [sys.executable, str(MECH / "writing/build.py"), "--publish", *flags],
        check=True,
    )
    files = calculate()
    digests = {
        name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())
    }
    sources = [
        REC / "episodes.jsonl",
        REC / "manifest.json",
        ROOT / "docs/recovery-results.json",
        MECH / "trace_episodes.csv",
        MECH / "decisions.csv",
        MECH / "forcing.jsonl",
        MECH / "scores-decisions.jsonl",
        MECH / "scores-summary.json",
        MECH / "blackbox/results.json",
        MECH / "whitebox/results.json",
    ]
    files["integrity.json"] = pack(
        {
            "algorithm": "sha256",
            "sources": {
                p.relative_to(ROOT).as_posix(): hashlib.sha256(
                    p.read_bytes()
                ).hexdigest()
                for p in sources
            },
            "files": digests,
        }
    )
    bad = []
    for name, data in files.items():
        path = DATA / name
        if args.check:
            if not path.is_file() or path.read_bytes() != data:
                bad.append(name)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    extra = [
        str(p.relative_to(DATA))
        for p in DATA.rglob("*")
        if p.is_file() and str(p.relative_to(DATA)) not in files
    ]
    if bad or extra:
        sys.exit(f"Stale site data. Changed {bad}; unexpected {extra}")
    # A static deployment can verify this snapshot even when Vercel only receives the public tree.
    public_files = {
        p.relative_to(SITE / "public").as_posix(): hashlib.sha256(
            p.read_bytes()
        ).hexdigest()
        for p in sorted((SITE / "public").rglob("*"))
        if p.is_file()
    }
    input_files = {}
    study_extensions = {
        ".py",
        ".js",
        ".mjs",
        ".md",
        ".in",
        ".json",
        ".jsonl",
        ".csv",
        ".txt",
        ".npz",
        ".gz",
        ".sh",
    }
    for p in sorted(MECH.rglob("*")):
        if (
            p.is_file()
            and p.suffix in study_extensions
            and not any(part.startswith(".") for part in p.relative_to(MECH).parts)
        ):
            input_files[p.relative_to(ROOT).as_posix()] = hashlib.sha256(
                p.read_bytes()
            ).hexdigest()
    for path, digest in json.loads(files["integrity.json"])["sources"].items():
        input_files[path] = digest
    lock_content = pack(
        {"algorithm": "sha256", "files": public_files, "inputs": input_files}
    )
    lock = SITE / "public-lock.json"
    if args.check:
        if not lock.is_file() or lock.read_bytes() != lock_content:
            sys.exit(
                "Stale public-lock.json. Regenerate after validating the source changes."
            )
    else:
        lock.write_bytes(lock_content)
    print(
        f"{'Verified' if args.check else 'Generated'} {len(files)} static data files, {len(public_files)} public artifacts."
    )


if __name__ == "__main__":
    main()
