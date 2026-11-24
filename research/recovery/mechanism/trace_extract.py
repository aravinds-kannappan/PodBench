"""Exploratory, not preregistered. Replay archived decisions and search the frozen SQLite menus."""
import argparse
import csv
import json
import re
import sys
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

HERE = Path(__file__).resolve().parent
RECOVERY = HERE.parent
sys.path.insert(0, str(RECOVERY))
from analyze import state_diagnostics
from environment import RecoveryEpisode
from run import MAX_STEPS

STUDY = "Exploratory (not preregistered)"
LABELS = (
    "exact state without submit", "wrong-row write", "duplicate write", "no valid decision",
    "premature submit", "invalid-action loop", "repeated-action loop", "incomplete reconciliation",
)
CLAIM = re.compile(
    r"\b(?:I(?:'ve| have)?\s+(?:already\s+)?(?:inspected|verified|checked)|"
    r"(?:inspection|verification)\s+(?:is\s+|was\s+)?(?:complete|completed|done))\b", re.I,
)


def compact(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def frozen_bytes(value):
    return (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")


def database(env):
    """Complete table contents as multisets. Row order and SQLite rowids are immaterial."""
    tables = env.db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    return {name: tuple(sorted(tuple(r) for r in env.db.execute(f'SELECT * FROM "{name}"')))
            for (name,) in tables}


def target_state(task, seed):
    env = RecoveryEpisode(task, seed, False)
    try:
        for action in (env.first_action, *env.followup_actions, "submit"):
            env.step(action)
        if not env.verify()["passed"]:
            raise ValueError("Reference target failed the frozen verifier")
        return database(env)
    finally:
        env.close()


def database_diff(actual, target):
    differences = {}
    for name in target:
        current, desired = Counter(actual[name]), Counter(target[name])
        if current != desired:
            differences[name] = {"extra": list((current - desired).elements()),
                                 "missing": list((desired - current).elements())}
    return differences


@contextmanager
def branch(env, action):
    was_submitted = env.submitted
    env.db.execute("SAVEPOINT candidate")
    try:
        env.step(action)
        yield
    finally:
        env.db.execute("ROLLBACK TO candidate")
        env.db.execute("RELEASE candidate")
        env.submitted = was_submitted


class Reachability:
    """Minimum remaining named moves to exact state or exact submission, within the budget."""
    def __init__(self):
        self.cache = {}

    def search(self, env, remaining):
        key = (env.task, env.case, tuple(database(env).items()), env.submitted, remaining)
        if key in self.cache:
            return self.cache[key]
        verdict = env.verify()
        exact = all(verdict["endpoints"].values())
        distances = [0 if exact else None, 0 if verdict["passed"] else None]
        # Each action maps to its shortest verified-submission distance, including this move.
        viable = {}
        if remaining and not env.submitted:
            for name in env.actions:
                with branch(env, name):
                    next_distances, _ = self.search(env, remaining - 1)
                for endpoint, child in enumerate(next_distances):
                    if child is None:
                        continue
                    distance = child + 1
                    if distances[endpoint] is None or distance < distances[endpoint]:
                        distances[endpoint] = distance
                    if endpoint == 1:
                        viable[name] = distance
        result = tuple(distances), viable
        self.cache[key] = result
        return result


def loop_period(sequence):
    """Smallest period of two equal, adjacent blocks ending on this turn."""
    for period in range(1, len(sequence) // 2 + 1):
        first, second = sequence[-2 * period:-period], sequence[-period:]
        if None not in first and first == second:
            return period
    return 0


def parse_failure(reply, menu, action):
    if action is not None:
        return None
    if not reply.strip():
        return "empty"
    if any(reply.strip().startswith(name + " ") for name in menu):
        return "valid name with extra text"
    token = reply.strip().split()[0]
    if re.fullmatch(r"[A-Za-z]+(?:_[A-Za-z]+)+", token) or len(reply.split()) == 1:
        return "unknown action name"
    return "free text"


def exclusive_label(verdict, diagnostics, decisions):
    if verdict["passed"]:
        raise ValueError("The archival failure taxonomy only applies to unsuccessful episodes")
    exact = all(verdict["endpoints"].values())
    if exact and not verdict["submitted"]:
        return LABELS[0]
    if diagnostics["collateral"]:
        return LABELS[1]
    if diagnostics["duplicate"]:
        return LABELS[2]
    if not any(d["parse_succeeded"] for d in decisions):
        return LABELS[3]
    if verdict["submitted"]:
        return LABELS[4]
    if decisions[-1]["invalid_loop_period"]:
        return LABELS[5]
    if decisions[-1]["action_loop_period"]:
        return LABELS[6]
    return LABELS[7]


def feedback(observation):
    return observation["result"], observation["error"]


def extract(raw_line, search, target):
    raw = json.loads(raw_line)
    base = {key: raw[key] for key in ("id", "model", "task", "seed", "committed", "instruction", "menu_order")}
    base["study"] = STUDY
    env = RecoveryEpisode(raw["task"], raw["seed"], raw["committed"])
    alternate = RecoveryEpisode(raw["task"], raw["seed"], not raw["committed"])
    try:
        raw["initial_state"] = env.verify()["observed"]
        first_lost = [None, None]
        decisions, actions, invalid_replies = [], [], []
        previous_reply = None
        inspected = False
        ambiguous_world = True
        for step in raw["steps"]:
            turn, reply = step["turn"], step["reply"]
            if not isinstance(reply, str) or turn != len(decisions) + 1:
                raise ValueError(f"Missing or out-of-order decision: {raw['id']}")
            remaining = MAX_STEPS - turn + 1
            before, viable = search.search(env, remaining)
            oracle = min(viable, key=viable.get) if viable else None
            # With indistinguishable histories the suggestion is identical in both worlds.
            evidence_proposal = "inspect" if ambiguous_world else oracle
            action = reply.strip() if reply.strip() in raw["menu"] else None
            same_action = bool(action and actions and actions[-1] == action)
            actions.append(action)
            invalid_replies.append(None if action else reply.strip())
            actual = env.step(action) if action else None
            prior_ambiguous = ambiguous_world
            if action and ambiguous_world:
                ambiguous_world = feedback(actual) == feedback(alternate.step(action))
            step.update(action=action, valid=action is not None, observation=actual)
            after, _ = search.search(env, remaining - 1)
            crossed = [a is not None and b is None for a, b in zip(before, after)]
            for endpoint, lost in enumerate(crossed):
                if lost and first_lost[endpoint] is None:
                    first_lost[endpoint] = turn
            decisions.append(dict(base, turn=turn, remaining_before=remaining,
                reply=reply, action=action, parse_succeeded=action is not None,
                parse_failure=parse_failure(reply, raw["menu"], action),
                position_1based=raw["menu"].index(action) + 1 if action else None,
                menu=raw["menu"], observation=actual, same_action_as_previous=same_action,
                same_reply_as_previous=reply == previous_reply, action_loop_period=loop_period(actions),
                invalid_loop_period=loop_period(invalid_replies), claims_inspection=bool(CLAIM.search(reply)),
                inspected_before=inspected, executed_inspect=action == "inspect" and actual["error"] is None,
                ambiguous_before=prior_ambiguous, exact_reachable_before=before[0] is not None,
                submission_reachable_before=before[1] is not None, min_moves_to_exact_before=before[0],
                min_moves_to_submission_before=before[1], exact_reachable_after=after[0] is not None,
                submission_reachable_after=after[1] is not None, crossed_exact=crossed[0],
                crossed_submission=crossed[1], viable_next=viable, force_oracle=oracle,
                evidence_proposal=evidence_proposal, force_evidence=(evidence_proposal if evidence_proposal in viable else None),
                diff_after=database_diff(database(env), target)))
            previous_reply = reply
            inspected = inspected or decisions[-1]["executed_inspect"]
        verdict = env.verify()
        raw["verdict"] = verdict
        if frozen_bytes(raw) != raw_line:
            raise ValueError(f"Fresh parser, SQL observations or verdict differ from archived bytes: {raw['id']}")
        diagnostics = state_diagnostics(env, verdict)
        label = exclusive_label(verdict, diagnostics, decisions)
        episode = dict(base, turns=len(decisions), first_action=actions[0], first_reply=decisions[0]["reply"],
            status=raw["status"], submitted=verdict["submitted"], exact_state=all(verdict["endpoints"].values()),
            exact_and_submitted=verdict["passed"], failure_label=label, invalid_decisions=actions.count(None),
            first_unreachable_exact=first_lost[0], first_unreachable_submission=first_lost[1],
            observed=verdict["observed"], final_diff=decisions[-1]["diff_after"])
        return episode, decisions
    finally:
        env.close()
        alternate.close()


def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0], lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: compact(v) if isinstance(v, (dict, list, bool)) else v for k, v in row.items()})


def collect(journal):
    search = Reachability()
    targets, episodes, decisions = {}, [], []
    for raw_line in journal.read_bytes().splitlines(keepends=True):
        source = json.loads(raw_line)
        key = source["task"], source["seed"]
        if key not in targets:
            targets[key] = target_state(*key)
        episode, steps = extract(raw_line, search, targets[key])
        episodes.append(episode)
        decisions.extend(steps)
    return episodes, decisions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journal", type=Path, default=RECOVERY / "episodes.jsonl")
    parser.add_argument("--output", type=Path, default=HERE)
    args = parser.parse_args()
    episodes, decisions = collect(args.journal)
    args.output.mkdir(parents=True, exist_ok=True)
    write_csv(args.output / "trace_episodes.csv", episodes)
    write_csv(args.output / "trace_decisions.csv", decisions)
    print(f"Replayed {len(episodes)} episodes and {len(decisions)} decisions byte for byte")


if __name__ == "__main__":
    main()
