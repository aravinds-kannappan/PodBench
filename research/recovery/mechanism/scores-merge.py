"""Combine per-checkpoint shards, checking coverage, prompts and probability bookkeeping."""
import argparse
import json
import math
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS = {"qwen2.5-0.5b": "qwen", "smollm2-360m": "smollm"}


def key(row):
    return row["episode_id"], row["turn"]


def merge(parts, kind, output):
    expected = {}
    for line in (HERE.parent / "episodes.jsonl").read_text().splitlines():
        episode = json.loads(line)
        prior = None
        for step in episode["steps"]:
            if kind != "swaps" or prior == "inspect":
                expected[episode["id"], step["turn"]] = (episode, step)
            prior = step["action"]
    rows = {}
    for model, slug in MODELS.items():
        for line in (parts / f"podbench-{slug}-{kind}.jsonl").read_text().splitlines():
            row = json.loads(line)
            k = key(row)
            if k in rows or k not in expected:
                raise ValueError(f"Unexpected or repeated decision {k}")
            e, s = expected[k]
            if row["model"] != model or model != e["model"] or row["reply"] != s["reply"]:
                raise ValueError(f"Archived decision mismatch at {k}")
            if kind == "greedy":
                path = row["greedy_path"]
                if not math.isclose(sum(path["token_logprobs"]), path["logprob"]):
                    raise ValueError(f"Invalid token path sum at {k}")
            else:
                candidates = row["candidates"]
                if list(candidates) != e["menu"]:
                    raise ValueError(f"Candidate menu differs at {k}")
                if not math.isclose(sum(v["menu_probability"] for v in candidates.values()), 1):
                    raise ValueError(f"Unnormalized menu at {k}")
                for action, score in candidates.items():
                    if len(score["token_ids"]) != len(score["token_logprobs"]) or not math.isclose(sum(score["token_logprobs"]), score["logprob"]):
                        raise ValueError(f"Token path mismatch at {k}/{action}")
                rank = sorted(candidates, key=lambda a: -candidates[a]["logprob"])
                if rank[:2] != [row["top_action"], row["runner_up"]]:
                    raise ValueError(f"Ranking mismatch at {k}")
                if kind == "scores" and row["prefix_tokens"] != s["input_tokens"]:
                    raise ValueError(f"Prefix length mismatch at {k}")
            rows[k] = row
    if rows.keys() != expected.keys():
        raise ValueError(f"Incomplete {kind} shards: {len(rows)} of {len(expected)}")
    with output.open("w", encoding="utf-8") as dest:
        for k in expected:
            dest.write(json.dumps(rows[k], separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n")
    print(f"Wrote {len(rows)} {kind} records to {output.name}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parts", required=True, type=Path)
    parser.add_argument("--kind", choices=("scores","swaps","greedy"), required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    filename = "scores-decisions.jsonl" if args.kind == "scores" else f"scores-{args.kind}.jsonl"
    merge(args.parts, args.kind, args.output or HERE / filename)
