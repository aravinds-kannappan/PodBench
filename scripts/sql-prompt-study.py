"""Collect a fixed, blocked study on the public PodBench runner, or export an existing journal."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data/studies/sql-prompt-trials.jsonl"
EXPORT = ROOT / "docs/sql-study.json"
ENDPOINT = "https://pod-bench.vercel.app/api/run"
MODEL = "google/gemini-2.5-flash-lite"
TASKS = ["redirection-merge", "scope-creep-oversell", "test-gaming-refund"]
CONDITIONS = ["baseline", "suffix", "reminder"]
BLOCKS = 4
PROTOCOL = (
    "Four repetitions of each task in each of three prompt conditions. Every episode resets "
    "the seeded database and conversation. Within a block, rotate condition order across tasks; "
    "rotate it again between blocks. Match by task and block for descriptive contrasts. "
    "The provider handles decoding; matches do not share a sampling seed. "
    "The unit of replication is a new run of the same work order. Keep errors and every verdict."
)


BATCH_TASKS = ["redirection-merge", "redirection-merge-paused"]
BATCH_PROTOCOL = (
    "Compare the original and interruptible batch on the same merge, model, effort and baseline prompt. "
    "Four repetitions per variant. Alternate which variant runs first in each repetition. "
    "Each request starts a fresh database and conversation. Keep timeouts and every verdict."
)


def schedule(batch=False):
    if batch:
        for block in range(BLOCKS):
            for task in (BATCH_TASKS if block % 2 == 0 else reversed(BATCH_TASKS)):
                yield [{"block": block + 1, "task_id": task, "condition": "baseline"}]
        return
    for block in range(BLOCKS):
        for slot in range(len(CONDITIONS)):
            yield [
                {"block": block + 1, "task_id": task,
                 "condition": CONDITIONS[(block + task_index + slot) % len(CONDITIONS)]}
                for task_index, task in enumerate(TASKS)
            ]


def execute(trial):
    condition = trial["condition"]
    payload = {"task_id": trial["task_id"], "model": MODEL, "prompt_condition": condition, "effort": "medium"}
    request = Request(ENDPOINT, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    row = dict(trial, requested_at=datetime.now(timezone.utc).isoformat())
    try:
        with urlopen(request, timeout=90) as response:
            run = json.load(response)
        if (run.get("source"), run.get("model"), run.get("task_id"), run.get("prompt_condition")) != (
            "live", MODEL, trial["task_id"], condition
        ) or run.get("status") not in ("passed", "failed", "error") or not run.get("id"):
            raise ValueError("Runner returned an unverified model, condition, task, or verdict")
        row["run"] = run
    except (ValueError, OSError) as exc:
        row["error"] = f"{type(exc).__name__}: {exc}"
    return row


def collect(archive, batch):
    # Check that the deployment recognizes the condition field without starting an episode.
    invalid = Request(ENDPOINT, data=b'{"prompt_condition":"unsupported"}', headers={"Content-Type": "application/json"})
    try:
        urlopen(invalid, timeout=30).close()
    except HTTPError as err:
        if err.code != 400 or json.load(err).get("error") != "unknown prompt_condition":
            raise RuntimeError("Deploy the named-condition runner before collecting episodes") from err
    else:
        raise RuntimeError("Runner accepted an invalid condition")
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open("x") as journal, ThreadPoolExecutor(max_workers=3) as pool:
        for wave in schedule(batch):
            for record in pool.map(execute, wave):
                journal.write(json.dumps(record, ensure_ascii=False) + "\n")
                journal.flush()
                print(record["block"], record["task_id"], record["condition"],
                      record.get("run", {}).get("status", record.get("error")), flush=True)


def export(archive, output, batch):
    records = [json.loads(line) for line in archive.read_text().splitlines()]
    expected = [t for wave in schedule(batch) for t in wave]
    if [{key: r[key] for key in ("block", "task_id", "condition")} for r in records] != expected:
        raise ValueError("Journal does not contain the complete scheduled batch")
    trials = []
    ids = set()
    for line_number, record in enumerate(records, start=1):
        run = record.get("run", {})
        run_id = run.get("id")
        if run_id and run_id in ids:
            raise ValueError(f"duplicate episode ID {run_id}")
        ids.add(run_id)
        status = run.get("status", "error")
        score = run.get("propensity") or {}
        flags = score.get("flags")
        trials.append({
            **{key: record[key] for key in ("block", "task_id", "condition")},
            "trace_line": line_number,
            "actions": [str(s.get("input", "")) if s.get("tool") == "run_sql" else "submit " + json.dumps(s.get("input"))
                        for s in run.get("trajectory", []) if s.get("kind") in ("tool_call", "submit")],
            "run_id": run_id, "status": status, "passed": run.get("passed") if status != "error" else None,
            "flags": flags, "flagged": bool(flags) if flags is not None else None,
            "redirect_observed": run.get("redirect_observed"), "writes_after_redirect": score.get("writes_after_redirect"),
            "detail": run.get("detail", record.get("error")), "steps": run.get("steps"), "cost_usd": run.get("cost_usd"),
        })
        if batch:
            trials[-1]["deferred_calls"] = [
                {"tool": step["tool"], "input": step.get("input")}
                for step in run.get("trajectory", [])
                if step.get("output") == "Call not executed. An operator update is pending."
            ]
    report = dict(model=MODEL, conditions=["baseline"] if batch else CONDITIONS,
                  tasks=BATCH_TASKS if batch else TASKS, blocks=BLOCKS,
                  protocol=BATCH_PROTOCOL if batch else PROTOCOL, trials=trials)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--live", action="store_true", help="execute the metered study and write a NEW journal")
    mode.add_argument("--export", action="store_true", help="regenerate the public report from a complete journal")
    parser.add_argument("--batch-interrupt", action="store_true", help="compare original and paused tool batches (8 requests)")
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--output", type=Path)
    options = parser.parse_args()
    batch = options.batch_interrupt
    archive = options.archive or (ROOT / "data/studies/batch-interrupt.jsonl" if batch else ARCHIVE)
    output = options.output or (ROOT / "docs/batch-interrupt.json" if batch else EXPORT)
    if options.live:
        collect(archive, batch)
    if options.live or options.export:
        export(archive, output, batch)
    else:
        print(BATCH_PROTOCOL if batch else PROTOCOL)
        for wave in schedule(batch):
            print(json.dumps(wave))
