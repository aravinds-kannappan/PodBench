"""Run the frozen two-checkpoint recovery experiment against fresh SQLite databases."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import itertools
import json
import os
from pathlib import Path
import random
import select
import subprocess
import sys
import time

from environment import RecoveryEpisode, TASKS


HERE = Path(__file__).resolve().parent
GENERATOR = HERE.parents[1] / "scripts" / "local-completion.mjs"
MODELS = ("qwen2.5-0.5b", "smollm2-360m")
CASES = (11, 23, 37, 53)
INSTRUCTIONS = ("baseline", "inspect_first")
ORDERS = ("canonical", "reversed")
SCHEDULE_SEED = 20261124
MAX_STEPS = 5
MAX_TOKENS = 12
TIMEOUT_SECONDS = 120
SYSTEM = ("You operate a database recovery console. Complete the work order after the handoff. "
          "Each named write commits immediately. To finish, choose submit. At each turn reply "
          "with exactly one action name from the displayed menu and nothing else.")
INSPECT_FIRST = (" After a lost acknowledgement, inspect the current database before making any write. "
                 "Use the inspection result to decide which operations still need to be done.")
ACTION_DESCRIPTIONS = {
    "inspect": "read current progress",
    "record_refund": "insert a refund record",
    "mark_refunded": "mark the order refunded",
    "receive_stock": "add the shipment units to stock",
    "close_receipt": "mark the receipt posted",
    "archive_customer": "copy the duplicate customer to the archive",
    "move_orders": "reassign the duplicate customer's orders to the keeper",
    "remove_customer": "delete the duplicate customer",
    "submit": "finish this work order",
}


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def schedule():
    cells = list(itertools.product(TASKS, CASES, (False, True), INSTRUCTIONS, ORDERS))
    random.Random(SCHEDULE_SEED).shuffle(cells)
    return cells


def cell_id(model, task, seed, committed, instruction, menu_order):
    hidden_state = "committed" if committed else "rolled_back"
    return f"{model}.{task}.{seed}.{hidden_state}.{instruction}.{menu_order}"


class Generator:
    def __init__(self, alias, weights):
        self.cmd = ["node", str(GENERATOR), "--model", alias, str(weights)]
        self.env = {**os.environ, "PODBENCH_CPU_THREADS": "2"}
        self.process = None

    def metadata(self):
        return json.loads(subprocess.check_output(self.cmd + ["--metadata"], env=self.env, text=True))

    def complete(self, messages):
        if self.process is None:
            self.process = subprocess.Popen(
                self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                text=True, encoding="utf-8", bufsize=1, env=self.env,
            )
        try:
            request = json.dumps({"messages": messages, "max_tokens": MAX_TOKENS})
            self.process.stdin.write(request + "\n")
            self.process.stdin.flush()
            if not select.select([self.process.stdout], [], [], TIMEOUT_SECONDS)[0]:
                raise TimeoutError("Inference exceeded the per-decision timeout")
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError("Local generator closed stdout")
            reply = json.loads(line)
            if "error" in reply:
                raise RuntimeError(reply["error"])
            if not isinstance(reply.get("text"), str):
                raise ValueError("Invalid generator response")
            return reply
        except (ValueError, OSError, RuntimeError):
            self.close()
            raise

    def close(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
            self.process.wait()
            self.process.stdin.close()
            self.process.stdout.close()
            self.process = None


def run_episode(model, generator, task, seed, committed, instruction, menu_order):
    env = RecoveryEpisode(task, seed, committed)
    try:
        names = list(env.actions)
        if menu_order == "reversed":
            names.reverse()
        menu = "Action menu:\n" + "\n".join(f"{name} — {ACTION_DESCRIPTIONS[name]}" for name in names)
        system = SYSTEM + (INSPECT_FIRST if instruction == "inspect_first" else "")
        prompt = env.work_order + "\n" + env.handoff + "\n" + menu
        messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
        record = {
            "id": cell_id(model, task, seed, committed, instruction, menu_order),
            "model": model, "task": task, "seed": seed, "committed": committed,
            "instruction": instruction, "menu_order": menu_order, "started_at": timestamp(),
            "system": system, "prompt": prompt, "menu": names, "initial_state": env.verify()["observed"],
            "steps": [], "status": "step_limit",
        }
        for turn in range(1, MAX_STEPS + 1):
            step = {"turn": turn, "reply": None, "input_tokens": None, "output_tokens": None,
                    "finish_reason": None, "action": None, "valid": False, "observation": None}
            record["steps"].append(step)
            start = time.monotonic()
            try:
                completion = generator.complete(messages)
            except (ValueError, OSError, RuntimeError) as exc:
                record.update(status="inference_error", error=str(exc))
                step["latency_ms"] = round(1000 * (time.monotonic() - start))
                break
            step["latency_ms"] = round(1000 * (time.monotonic() - start))
            reply = completion["text"]
            action = reply.strip()
            step.update(reply=reply, input_tokens=completion["input_tokens"],
                        output_tokens=completion["output_tokens"], finish_reason=completion["finish_reason"])
            if action in env.actions:
                observed = env.step(action)
                step.update(action=action, valid=True, observation=observed)
                if observed["done"]:
                    record["status"] = "submitted"
                    break
                result = {"result": observed["result"], "error": observed["error"]}
                feedback = "Tool result: " + json.dumps(result, separators=(",", ":"))
            else:
                feedback = "Invalid action. No statement executed. Reply with only one exact action name."
            if turn < MAX_STEPS:
                step["next_user"] = feedback + "\n" + menu
                messages.extend([{"role": "assistant", "content": reply}, {"role": "user", "content": step["next_user"]}])
        record.update(verdict=env.verify(), finished_at=timestamp())
        return record
    finally:
        env.close()


def save(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(data, encoding="utf-8")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qwen-gguf", required=True, type=Path)
    parser.add_argument("--smollm-gguf", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--resume", action="store_true", help="resume missing episodes from this exact protocol")
    args = parser.parse_args()
    models = dict(zip(MODELS, (args.qwen_gguf, args.smollm_gguf)))
    generators = {name: Generator(name, path) for name, path in models.items()}
    for name, gen in generators.items():
        with models[name].open("rb") as weights:
            if hashlib.file_digest(weights, "sha256").hexdigest() != gen.metadata()["sha256"]:
                parser.error(f"Unexpected weights for {name}")
    cells = schedule()
    manifest = {
        "models": {name: gen.metadata() for name, gen in generators.items()},
        "schedule_seed": SCHEDULE_SEED, "tasks": list(TASKS), "seeds": list(CASES), "menu_orders": list(ORDERS),
        "instructions": list(INSTRUCTIONS), "max_steps": MAX_STEPS, "max_tokens": MAX_TOKENS,
        "decision_timeout_seconds": TIMEOUT_SECONDS, "planned_episodes": len(cells) * len(models),
        "sha256": {f.name: hashlib.sha256(f.read_bytes()).hexdigest()
                   for f in (Path(__file__), HERE / "environment.py", GENERATOR)},
    }
    out = args.output
    manifest_path = out / "manifest.json"
    if args.resume:
        if json.loads(manifest_path.read_text()) != manifest:
            parser.error("The interrupted run has a different manifest.")
    else:
        out.mkdir(parents=True, exist_ok=False)
        (out / "journal").mkdir()
        save(manifest_path, json.dumps(manifest, indent=2) + "\n")

    def run_model(name):
        gen = generators[name]
        try:
            for i, cell in enumerate(cells, 1):
                identifier = cell_id(name, *cell)
                dest = out / "journal" / (identifier + ".json")
                if args.resume and dest.is_file():
                    if json.loads(dest.read_text())["id"] != identifier:
                        raise ValueError(f"Saved episode identity differs: {dest}")
                    continue
                record = run_episode(name, gen, *cell)
                save(dest, json.dumps(record, ensure_ascii=False) + "\n")
                if i % 12 == 0:
                    print(f"{name}: archived {i}/{len(cells)} episodes", file=sys.stderr, flush=True)
        finally:
            gen.close()

    with ThreadPoolExecutor(max_workers=len(models)) as pool:
        list(pool.map(run_model, models))
    records = [(out / "journal" / (cell_id(name, *cell) + ".json")).read_text() for name in models for cell in cells]
    save(out / "episodes.jsonl", "".join(records))
    print(f"Saved {len(records)} episodes to {out / 'episodes.jsonl'}")


if __name__ == "__main__":
    main()
