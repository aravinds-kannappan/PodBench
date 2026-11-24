"""Reconstruct the ChatML turns shown during collection. Print replay requests as JSONL."""
import argparse
from pathlib import Path
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from environment import RecoveryEpisode

HERE = Path(__file__).resolve().parents[1]


def requests(episode, swaps):
    messages = [{"role": "system", "content": episode["system"]}, {"role": "user", "content": episode["prompt"]}]
    alt = RecoveryEpisode(episode["task"], episode["seed"], not episode["committed"])
    alternative = None
    try:
        for step in episode["steps"]:
            if not swaps or alternative is not None:
                row = {k: episode[k] for k in ("model", "task", "seed", "committed", "menu_order", "instruction", "menu")}
                current = list(messages)
                if swaps:
                    current[-1] = {"role": "user", "content": alternative}
                    row["observation_changed"] = current[-1] != messages[-1]
                    row["original_feedback"] = messages[-1]["content"].split("\nAction menu:", 1)[0]
                    row["swapped_feedback"] = alternative.split("\nAction menu:", 1)[0]
                yield {**row, "episode_id": episode["id"], "turn": step["turn"], "messages": current,
                       "reply": step["reply"], "logged_action": step["action"], "input_tokens": step["input_tokens"],
                       "output_tokens": step["output_tokens"], "finish_reason": step["finish_reason"]}
            alternative = None
            if step["valid"]:
                alternate_obs = alt.step(step["action"])
                if step["action"] == "inspect" and "next_user" in step:
                    result = {k: alternate_obs[k] for k in ("result", "error")}
                    marker = step["next_user"].index("\nAction menu:")
                    alternative = "Tool result: " + json.dumps(result, separators=(",", ":")) + step["next_user"][marker:]
            if "next_user" in step:
                messages.extend([{"role": "assistant", "content": step["reply"]},
                                 {"role": "user", "content": step["next_user"]}])
    finally:
        alt.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journal", type=Path, default=HERE / "episodes.jsonl")
    parser.add_argument("--swaps", action="store_true")
    args = parser.parse_args()
    for line in args.journal.read_text().splitlines():
        for record in requests(json.loads(line), args.swaps):
            print(json.dumps(record, ensure_ascii=False))
