"""Check frozen collector files and the exact model-facing inputs in a complete archive."""
import argparse
import hashlib
import json
from pathlib import Path

from environment import RecoveryEpisode
from run import ACTION_DESCRIPTIONS, GENERATOR, HERE, INSPECT_FIRST, MAX_STEPS, MODELS, SYSTEM, cell_id, schedule


def check(actual, expected, location):
    if actual != expected:
        raise ValueError(f"Input audit mismatch in {location}")


def check_episode(record, design, matched):
    model, task, seed, committed, instruction, order = design
    identifier = cell_id(*design)
    check(record["id"], identifier, "scheduled episode ID")
    check(tuple(record[k] for k in ("model", "task", "seed", "committed", "instruction", "menu_order")),
          design, identifier + " factors")
    episode = RecoveryEpisode(task, seed, committed)
    try:
        names = list(episode.actions)
        if order == "reversed":
            names.reverse()
        menu = "Action menu:\n" + "\n".join(f"{name} — {ACTION_DESCRIPTIONS[name]}" for name in names)
        check(record["menu"], names, identifier + " menu")
        prompt = episode.work_order + "\n" + episode.handoff + "\n" + menu
        check(record["prompt"], prompt, identifier + " prompt")
        system = SYSTEM + (INSPECT_FIRST if instruction == "inspect_first" else "")
        check(record["system"], system, identifier + " system message")
        pair = model, task, seed, instruction, order
        visible = record["system"], record["prompt"]
        check(visible, matched.setdefault(pair, visible), identifier + " hidden-world match")
        check(record["initial_state"], episode.verify()["observed"], identifier + " initial database")
    finally:
        episode.close()
    for step in record["steps"]:
        expected = None
        if step["reply"] is not None and step["turn"] < MAX_STEPS and step["action"] != "submit":
            if step["valid"]:
                returned = {k: step["observation"][k] for k in ("result", "error")}
                feedback = "Tool result: " + json.dumps(returned, separators=(",", ":"))
            else:
                feedback = "Invalid action. No statement executed. Reply with only one exact action name."
            expected = feedback + "\n" + menu
        check(step.get("next_user"), expected, f"{identifier} turn {step['turn']} follow-up")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", type=Path, default=HERE, help="directory with manifest.json and episodes.jsonl")
    parser.add_argument("--results", type=Path, help="optionally verify the analysis file's journal SHA-256")
    args = parser.parse_args()
    manifest = json.loads((args.collection / "manifest.json").read_text())
    frozen = (HERE / "run.py", HERE / "environment.py", GENERATOR)
    check(manifest["sha256"], {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in frozen}, "collector files")
    raw = (args.collection / "episodes.jsonl").read_bytes()
    checksum = hashlib.sha256(raw).hexdigest()
    if args.results:
        check(json.loads(args.results.read_text())["journal_sha256"], checksum, "analysis archive hash")
    lines = raw.splitlines()
    expected = [(model, *cell) for model in MODELS for cell in schedule()]
    check(manifest["planned_episodes"], len(expected), "manifest schedule")
    check(len(lines), len(expected), "archive size")
    matched = {}
    for line, design in zip(lines, expected):
        check_episode(json.loads(line), design, matched)
    print(f"Verified model inputs in {len(lines)} episodes and {len(matched)} hidden-world pairs.")
    print(f"Journal SHA-256 {checksum}")


if __name__ == "__main__":
    main()
