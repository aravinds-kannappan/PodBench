"""Intervene at one frozen decision and resume the original greedy policy."""
import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from environment import RecoveryEpisode
from run import Generator, MAX_STEPS

POLICIES = ("oracle", "evidence")
FEEDBACK = "Invalid action. No statement executed. Reply with only one exact action name."


def histories(record):
    messages = [{"role": "system", "content": record["system"]}, {"role": "user", "content": record["prompt"]}]
    for step in record["steps"]:
        yield messages.copy()
        if "next_user" in step:
            messages.extend([{"role": "assistant", "content": step["reply"]},
                             {"role": "user", "content": step["next_user"]}])


def key_for(model, messages):
    return hashlib.sha256(json.dumps([model, messages], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def apply_reply(env, reply, messages, menu_text):
    action = reply.strip()
    obs = env.step(action) if action in env.actions else None
    if obs is not None:
        feedback = "Tool result: " + json.dumps({k: obs[k] for k in ("result", "error")}, separators=(",", ":"))
    else:
        feedback = FEEDBACK
    messages.extend([{"role": "assistant", "content": reply}, {"role": "user", "content": feedback + "\n" + menu_text}])
    return {"reply": reply, "action": action if obs is not None else None, "observation": obs}


def branch(record, turn, intervention, messages, complete):
    env = RecoveryEpisode(record["task"], record["seed"], record["committed"])
    try:
        for s in record["steps"][:turn - 1]:
            if s["valid"]:
                assert env.step(s["action"]) == s["observation"]
        menu = "Action menu:\n" + record["prompt"].split("\nAction menu:\n", 1)[1]
        steps = []
        for at in range(turn, MAX_STEPS + 1):
            if at == turn:
                reply, source = intervention, "forced"
            else:
                reply, source = complete(record["model"], messages)
            s = apply_reply(env, reply, messages, menu)
            steps.append(dict(turn=at, source=source, **s))
            if env.submitted:
                break
        verdict = env.verify()
        return {"continuation": steps, "passed": verdict["passed"], "submitted": verdict["submitted"],
                "exact_state": all(verdict["endpoints"].values()), "verdict": verdict}
    finally:
        env.close()


def collect(args):
    records = [json.loads(s) for s in (HERE.parent / "episodes.jsonl").read_text().splitlines()]
    manifest = json.loads((HERE.parent / "manifest.json").read_text())
    generators = {}
    for model, meta in manifest["models"].items():
        path = args.weights / meta["filename"]
        # A local filename may be supplied explicitly without changing model identity.
        if not path.exists():
            path = args.weights / ("qwen.gguf" if model.startswith("qwen") else "smollm2.gguf")
        generators[model] = Generator(model, path)
        with path.open("rb") as f:
            if hashlib.file_digest(f, "sha256").hexdigest() != meta["sha256"]:
                raise ValueError("GGUF digest mismatch: " + model)
    cache = {}
    for record in records:
        for prefix, s in zip(histories(record), record["steps"]):
            key = key_for(record["model"], prefix)
            if key in cache and cache[key][0] != s["reply"]:
                raise ValueError("Archived replies diverge at identical prefixes")
            cache[key] = (s["reply"], "frozen-prefix")
    args.cache.parent.mkdir(parents=True, exist_ok=True)
    if args.cache.exists():
        for line in args.cache.read_text().splitlines():
            k, text = json.loads(line)
            cache[k] = (text, "greedy")
    with (HERE / "trace_decisions.csv").open() as f:
        choices = {(r["id"], int(r["turn"])): r for r in csv.DictReader(f)}

    def complete(model, messages):
        k = key_for(model, messages)
        if k not in cache:
            reply = generators[model].complete(messages)["text"]
            with args.cache.open("a") as stream:
                stream.write(json.dumps([k, reply]) + "\n")
            cache[k] = (reply, "greedy")
        return cache[k]

    rows = []
    try:
        for i, record in enumerate(records, 1):
            for turn, prefix in enumerate(histories(record), 1):
                outcomes = {}
                for policy in POLICIES:
                    action = choices[record["id"], turn]["force_" + policy]
                    row = dict(id=record["id"], turn=turn, policy=policy, eligible=bool(action),
                               forced_action=action or None, passed=None)
                    if action:
                        if action not in outcomes:
                            outcomes[action] = branch(record, turn, action, prefix.copy(), complete)
                        row.update(outcomes[action])
                    rows.append(row)
            if i % 12 == 0:
                print(f"Evaluated {i}/{len(records)} frozen episodes; {len(cache)} cached prompts", flush=True)
    finally:
        for gen in generators.values():
            gen.close()
    out = HERE / "forcing.jsonl"
    out.with_suffix(".tmp").write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":"))+"\n" for r in rows))
    out.with_suffix(".tmp").replace(out)
    counts = Counter((r["policy"], r["eligible"], r["passed"]) for r in rows)
    print(counts)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--weights", required=True, type=Path)
    p.add_argument("--cache", required=True, type=Path, help="private resumable cache for this pinned study")
    collect(p.parse_args())
