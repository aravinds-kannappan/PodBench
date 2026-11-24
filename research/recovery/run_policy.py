"""Evaluate an external JSON Lines policy on the published 96-cell SQLite recovery schedule."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import time

from run import HERE, MAX_STEPS, MAX_TOKENS, SCHEDULE_SEED, TIMEOUT_SECONDS, cell_id, run_episode, schedule


class ExternalPolicy:
    """A single long-lived subprocess accepts one request and returns one JSON line per turn."""

    def __init__(self, command):
        self.command = command
        self.process = None

    def _read_reply(self):
        deadline = time.monotonic() + TIMEOUT_SECONDS
        output = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            stream = self.process.stdout
            if remaining <= 0 or not select.select([stream], [], [], remaining)[0]:
                raise TimeoutError("Policy exceeded the per-decision timeout.")
            chunk = os.read(stream.fileno(), 8192)
            if not chunk:
                raise ValueError("Policy closed stdout before returning a complete JSON line.")
            output.extend(chunk)
            if b"\n" in chunk:
                line, trailing = output.split(b"\n", 1)
                if trailing.strip():
                    raise ValueError("Policy returned extra output after the requested decision.")
                return json.loads(line)

    def complete(self, messages):
        if self.process is None:
            self.process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            payload = {"messages": messages, "max_tokens": MAX_TOKENS}
            self.process.stdin.write(json.dumps(payload).encode() + b"\n")
            self.process.stdin.flush()
            reply = self._read_reply()
            if not isinstance(reply, dict):
                raise ValueError("Expected a JSON object from the policy.")
            if "error" in reply:
                raise ValueError(f"Policy error: {reply['error']}")
            if not isinstance(reply.get("text"), str):
                raise ValueError("The policy response must contain a text string.")
            for field in ("input_tokens", "output_tokens"):
                value = reply.setdefault(field, None)
                if value is not None and (type(value) is not int or value < 0):
                    raise ValueError(f"{field} must be a nonnegative integer or null.")
            reason = reply.setdefault("finish_reason", None)
            if reason is not None and not isinstance(reason, str):
                raise ValueError("finish_reason must be a string or null.")
            return reply
        except (OSError, ValueError):
            self.close()
            raise

    def close(self):
        if self.process is None:
            return
        p = self.process
        self.process = None
        if p.poll() is None:
            p.terminate()
        try:
            p.wait(timeout=2)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
        p.stdin.close()
        p.stdout.close()


def run_manifest(model, revision, command, cells):
    names = ("task", "seed", "committed", "instruction", "menu_order")
    sources = (Path(__file__), HERE / "run.py", HERE / "environment.py", HERE / "PROTOCOL.md")
    return {
        "model": model, "revision": revision, "command": command, "schedule_seed": SCHEDULE_SEED,
        "max_steps": MAX_STEPS, "max_tokens": MAX_TOKENS, "timeout_seconds": TIMEOUT_SECONDS,
        "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
        "planned_episodes": len(cells),
        "schedule": [dict(zip(names, cell), id=cell_id(model, *cell)) for cell in cells],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", required=True, help="model or policy identifier used in every trace")
    parser.add_argument("--revision", required=True, help="weight hash, version or immutable revision")
    parser.add_argument("--output", type=Path, help="new directory for manifest.json and episodes.jsonl")
    parser.add_argument("--plan-only", action="store_true", help="print the manifest and exit without launching a policy")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="-- EXECUTABLE [ARGS...]")
    args = parser.parse_args()
    if not args.model_id.strip() or not args.revision.strip():
        parser.error("model ID and revision must be nonempty")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    cells = schedule()
    manifest = run_manifest(args.model_id, args.revision, command, cells)
    if args.plan_only:
        print(json.dumps(manifest, indent=2))
        return
    if not args.output or not command:
        parser.error("collection requires --output NEW_DIRECTORY and -- EXECUTABLE [ARGS...]")
    if not shutil.which(command[0]):
        parser.error(f"Cannot find executable: {command[0]}")
    try:
        args.output.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        parser.error(f"Output directory already exists: {args.output}")
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    policy = ExternalPolicy(command)
    errors = 0
    try:
        with (args.output / "episodes.jsonl").open("x", encoding="utf-8") as journal:
            for cell in cells:
                record = run_episode(args.model_id, policy, *cell)
                record["model_revision"] = args.revision
                journal.write(json.dumps(record, ensure_ascii=False) + "\n")
                journal.flush()
                errors += record["status"] == "inference_error"
    finally:
        policy.close()
    print(f"Archived {len(cells)} episodes, including {errors} inference errors, in {args.output}")
    if errors:
        return 1


if __name__ == "__main__":
    sys.exit(main())
