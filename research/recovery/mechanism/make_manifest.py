"""Fingerprint the measured files for the exploratory recovery release."""

import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest():
    frozen = json.loads((HERE.parent / "manifest.json").read_bytes())
    groups = {
        "trajectory": [
            "trace_decisions.csv",
            "trace_episodes.csv",
            "trace_schema.json",
            "trace_extract.py",
        ],
        "teacher_forced": [
            "scores-decisions.jsonl",
            "scores-greedy.jsonl",
            "scores-audit.json",
            "scores-numerics.json",
            "scores-warm-controls.json",
            "scores-manifest.json",
            "scores-evaluate.mjs",
            "scores-inputs.py",
            "scores-method.md",
        ],
        "instruction": [
            "scores-swaps.jsonl",
            "scores-summary.json",
            "scores-summarize.py",
        ],
        "single_action_forcing": [
            "forcing.jsonl",
            "forcing-paired.json",
            "force.py",
            "decisions.csv",
            "first_tokens.csv",
            "action_scores.csv",
            "schema.json",
        ],
        "black_box": [
            "blackbox/design.json",
            "blackbox/placebos.json",
            "blackbox/manifest.json",
            "blackbox/traces.jsonl",
            "blackbox/decisions.jsonl",
            "blackbox/results.json",
        ],
        "white_box": [
            "whitebox/weights.json",
            "whitebox/manifest.json",
            "whitebox/protocol.md",
            "whitebox/requirements.txt",
            "whitebox/results.json",
        ],
    }
    return {
        "study": "Exploratory (not preregistered)",
        "release": "recovery-mechanism-v1.0.0",
        "frozen_release": "recovery-v1.0.0",
        "frozen_journal_sha256": digest(HERE.parent / "episodes.jsonl"),
        "frozen_manifest_sha256": digest(HERE.parent / "manifest.json"),
        "gguf_models": frozen["models"],
        "original_models": json.loads((HERE / "whitebox/weights.json").read_bytes()),
        "settings": {
            "archive_protocol": "../PROTOCOL.md",
            "score_definition": "scores-method.md",
            "forcing_budget": frozen["max_steps"],
            "forcing_reply_limit": frozen["max_tokens"],
            "black_box_design": "blackbox/design.json",
            "white_box_design": "whitebox/protocol.md",
        },
        "artifacts": {
            group: {name: digest(HERE / name) for name in paths}
            for group, paths in groups.items()
        },
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    dest = HERE / "manifest.json"
    data = (json.dumps(manifest(), indent=2, ensure_ascii=False) + "\n").encode()
    if args.check:
        if dest.read_bytes() != data:
            p.exit(1, "Stale mechanism manifest\n")
    else:
        dest.write_bytes(data)
