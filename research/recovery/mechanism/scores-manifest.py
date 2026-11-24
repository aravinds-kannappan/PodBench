"""Fingerprint the released score files, scoring programs, raw journal and pinned checkpoints."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest():
    study = json.loads((HERE.parent / "manifest.json").read_text())
    runtime = json.loads((HERE.parent / "runtime.json").read_text())
    source = ["scores-inputs.py","scores-evaluate.mjs","scores-merge.py","scores-summarize.py","scores-qa.py","scores_test.py","scores-manifest.py","explain.py"]
    data = ["scores-decisions.jsonl","scores-swaps.jsonl","scores-branch-controls.jsonl","scores-greedy.jsonl",
            "scores-summary.json","scores-audit.json","scores-numerics.json","scores-warm-controls.json"]
    return {"version":"cold-prefix-v2", "study":"Exploratory (not preregistered)",
            "journal_sha256":digest(HERE.parent / "episodes.jsonl"), "checkpoints":study["models"],
            "collection_source_sha256":study["sha256"],
            "runtime":{k:runtime[k] for k in ("system", "machine", "cpu_model", "python", "node", "cpu_quota")},
            "sequence":"Cold full ChatML prefix, followed by one forced token per decode step. Only KV at this complete prefix is reused for candidate continuations.",
            "normalization":"Untruncated vocabulary softmax at temperature one. Menu probabilities renormalize canonical strings plus <|im_end|>.",
            "replay_counts":{"observed_decisions":612,"counterfactual_next_decisions":128,"cold_branch_controls":12},
            "source_sha256":{f:digest(HERE/f) for f in source}, "data_sha256":{f:digest(HERE/f) for f in data}}


if __name__ == "__main__":
    (HERE / "scores-manifest.json").write_text(json.dumps(manifest(),indent=2)+"\n")
