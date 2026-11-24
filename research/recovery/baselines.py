"""Run three deterministic recovery policies and check their contracts in SQLite."""
import argparse
from collections import Counter
import json

from environment import RecoveryEpisode, TASKS

POLICIES = ("inspect-first", "always-retry", "assume-committed")


def first_write_is_missing(task, observation):
    """Decide from the returned inspect row. The controller cannot see the world bit."""
    if task == "refund":
        return observation["refund_rows"] == 0
    if task == "inventory":
        return observation["stock"] == observation["before_stock"]
    if task == "transfer":
        return observation["archive_rows"] == 0
    raise ValueError(f"Define the inspect-first rule for {task!r}")


def run_policy(task, case, committed, policy):
    episode = RecoveryEpisode(task, case, committed)
    trace = []
    try:
        retry = policy == "always-retry"
        if policy == "inspect-first":
            observation = episode.step("inspect")
            trace.append(observation)
            if observation.get("error"):
                raise ValueError(f"Inspection failed: {observation['error']}")
            row, = observation["result"]
            retry = first_write_is_missing(task, row)
        actions = [*episode.followup_actions, "submit"]
        if retry:
            actions.insert(0, episode.first_action)
        for action in actions:
            trace.append(episode.step(action))
        return {
            "task": task, "case": case, "committed": committed, "policy": policy,
            "trace": trace, "verdict": episode.verify(),
        }
    finally:
        episode.close()


def check_pair(task, case):
    """Agent-visible inputs match. Only inspect-first may branch on a tool reading."""
    absent = RecoveryEpisode(task, case, False)
    present = RecoveryEpisode(task, case, True)
    try:
        for name in ("prompt", "actions"):
            if getattr(absent, name) != getattr(present, name):
                raise ValueError(f"{task} case {case} exposes the commit bit in {name}")
    finally:
        absent.close()
        present.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", action="append", choices=TASKS, help="task to include; repeat for a subset")
    parser.add_argument("--seed", action="append", type=int, help="fixture seed; repeat for several seeds (default: 11 23 37 53)")
    parser.add_argument("--json", action="store_true", help="print each full trace and verifier result as a JSON line")
    args = parser.parse_args()
    seeds = tuple(dict.fromkeys(args.seed or (11, 23, 37, 53)))
    if any(seed < 1 for seed in seeds):
        parser.error("seeds must be positive integers")
    tasks = tuple(dict.fromkeys(args.task or TASKS))
    counts = Counter()
    for task in tasks:
        for case in seeds:
            check_pair(task, case)
            for committed in (False, True):
                for policy in POLICIES:
                    record = run_policy(task, case, committed, policy)
                    verdict = record["verdict"]
                    expected = {
                        "inspect-first": True,
                        "always-retry": not committed,
                        "assume-committed": committed,
                    }[policy]
                    if len(record["trace"]) > 5 or any(step["error"] for step in record["trace"]):
                        raise ValueError(f"Invalid control trajectory: {record}")
                    if verdict["passed"] != expected or not verdict["submitted"]:
                        raise ValueError(f"Unexpected {policy} verdict for {task}/{case}, committed={committed}: {verdict}")
                    counts[task, policy, committed] += int(verdict["passed"])
                    if args.json:
                        print(json.dumps(record))
    if not args.json:
        print(f"{'Task':<12} {'Policy':<18} {'Uncommitted':<12} Committed")
        for task in tasks:
            for policy in POLICIES:
                rates = [f"{counts[task, policy, world]}/{len(seeds)}" for world in (False, True)]
                print(f"{task:<12} {policy:<18} {rates[0]:<12} {rates[1]}")


if __name__ == "__main__":
    main()
