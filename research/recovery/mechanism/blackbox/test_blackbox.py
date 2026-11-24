"""Offline checks for paired controls, exposure timing, and the permutation grid."""
import json
import unittest

from collect import archive_prefixes, episode, key_for
from probes import DESIGN, HERE, jobs, panel


class Script:
    model = DESIGN["models"][0]

    def __init__(self, answers):
        self.answers = iter(answers)

    def query(self, messages):
        return key_for(self.model, messages), {"text":next(self.answers)}


class BlackBoxControls(unittest.TestCase):
    def test_unmodified_prefixes_match_parent_archive(self):
        for name in DESIGN["models"]:
            recorded = archive_prefixes(name)

            class Replay:
                model = name

                def query(self, messages):
                    key = key_for(self.model, messages)
                    return key, recorded[key][0]

            for job in jobs(name):
                if job[3].id in ("clean", "order_000"):
                    result = episode(Replay(), *job)
                    self.assertNotEqual(result["status"], "inference_error")

    def test_world_swap_changes_display_only(self):
        variant = next(v for v in panel() if v.id == "forced_swap")
        result = episode(Script(["submit"]), "refund", 11, True, variant, None)
        inspect = result["steps"][0]
        self.assertEqual(inspect["shown_result"][0]["refund_rows"], 0)
        self.assertEqual(inspect["observation"]["result"][0]["refund_rows"], 1)
        self.assertTrue(result["endpoints"]["refund_once"])
        self.assertTrue(result["inspection_seen"])
        self.assertEqual(result["first_action"], "submit")

    def test_terminal_inspection_without_another_turn_is_unexposed(self):
        variant = next(v for v in panel() if v.id == "tool_note")
        policy = Script(["invalid"] * 4 + ["inspect"])
        result = episode(policy, "refund", 11, True, variant, None)
        self.assertIn("desk_note", result["steps"][-1]["shown_result"][0])
        self.assertFalse(result["inspection_seen"])
        self.assertIsNone(result["after_inspection"])

    def test_published_episodes_replay(self):
        records = [json.loads(line) for line in (HERE / "decisions.jsonl").read_text().splitlines()]
        decisions = {record["key"]:record for record in records}
        traces = {row["id"]:row for row in (json.loads(line) for line in (HERE / "traces.jsonl").read_text().splitlines())}
        self.assertEqual(len(records), len(decisions))
        used = set()
        for name in DESIGN["models"]:
            class Archive:
                model = name

                def query(self, messages):
                    key = key_for(self.model, messages)
                    item = decisions[key]
                    if item["messages"] != messages or item["model"] != self.model:
                        raise AssertionError("Archived context or checkpoint differs")
                    used.add(key)
                    return key, item["completion"]

            for job in jobs(name):
                replayed = episode(Archive(), *job)
                self.assertEqual(replayed, traces.pop(replayed["id"]))
        self.assertFalse(traces)
        self.assertEqual(used, set(decisions))

    def test_permutations(self):
        grid = list(jobs("qwen2.5-0.5b"))
        for task, count in (("refund",24),("inventory",24),("transfer",120)):
            orders = [entry[4] for entry in grid if entry[0] == task and entry[4]]
            self.assertEqual(len(orders), count)
            self.assertEqual(len(set(orders)), count)


if __name__ == "__main__":
    unittest.main()
