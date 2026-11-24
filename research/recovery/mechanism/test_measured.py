"""Audit every shipped counterfactual directly in the frozen SQLite environment."""

import json
import unittest
from pathlib import Path

from force import RecoveryEpisode
from assemble import assemble

HERE = Path(__file__).resolve().parent


class PublishedInterventions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = {
            r["id"]: r
            for r in map(
                json.loads, (HERE.parent / "episodes.jsonl").read_bytes().splitlines()
            )
        }
        cls.branches = [
            json.loads(s) for s in (HERE / "forcing.jsonl").read_bytes().splitlines()
        ]

    def test_complete_balanced_design(self):
        expected = {
            (r["id"], s["turn"], p)
            for r in self.archive.values()
            for s in r["steps"]
            for p in ("oracle", "evidence")
        }
        actual = [(b["id"], b["turn"], b["policy"]) for b in self.branches]
        self.assertEqual(set(actual), expected)
        self.assertEqual(len(actual), len(expected))
        self.assertEqual(2 * len(assemble()), len(expected))

    def test_replay_every_intervention(self):
        for b in self.branches:
            if not b["eligible"]:
                self.assertIsNone(b["forced_action"])
                self.assertIsNone(b["passed"])
                self.assertNotIn("continuation", b)
                continue
            raw = self.archive[b["id"]]
            env = RecoveryEpisode(raw["task"], raw["seed"], raw["committed"])
            try:
                for step in raw["steps"][: b["turn"] - 1]:
                    if step["valid"]:
                        self.assertEqual(env.step(step["action"]), step["observation"])
                actual = b["continuation"]
                self.assertEqual(actual[0]["reply"], b["forced_action"])
                self.assertEqual(actual[0]["source"], "forced")
                for turn, step in enumerate(actual, b["turn"]):
                    self.assertEqual(step["turn"], turn)
                    self.assertLessEqual(turn, 5)
                    action = step["reply"].strip()
                    self.assertFalse(env.submitted)
                    self.assertEqual(
                        step["action"], action if action in env.actions else None
                    )
                    self.assertEqual(
                        env.step(action) if action in env.actions else None,
                        step["observation"],
                    )
                verdict = env.verify()
                self.assertEqual(verdict, b["verdict"])
                self.assertEqual(verdict["passed"], b["passed"])
                self.assertEqual(all(verdict["endpoints"].values()), b["exact_state"])
                self.assertTrue(env.submitted or actual[-1]["turn"] == 5)
            finally:
                env.close()


if __name__ == "__main__":
    unittest.main()
