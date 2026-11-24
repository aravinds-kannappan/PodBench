import json
import unittest
from pathlib import Path
from force import branch, histories, key_for


class ContinuationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = [json.loads(s) for s in (Path(__file__).resolve().parents[1] / "episodes.jsonl").read_text().splitlines()]

    def test_reuse_identical_frozen_prefix(self):
        row = next(r for r in self.rows if r["steps"][0]["valid"] and len(r["steps"]) > 1)
        known = {key_for(row["model"], m): s["reply"] for m, s in zip(histories(row), row["steps"])}
        def complete(model, messages):
            return known[key_for(model, messages)], "frozen-prefix"
        result = branch(row, 1, row["steps"][0]["reply"], next(histories(row)), complete)
        self.assertEqual(result["verdict"], row["verdict"])
        self.assertEqual([s["observation"] for s in result["continuation"]], [s["observation"] for s in row["steps"]])

    def test_force_submit_terminates_without_generation(self):
        row = self.rows[0]
        result = branch(row, 1, "submit", next(histories(row)), None)
        self.assertEqual(len(result["continuation"]), 1)
        self.assertTrue(result["submitted"])
        self.assertFalse(result["passed"])


if __name__ == "__main__":
    unittest.main()
