"""Regression checks for the scheduled denominator, SQLite replay and paired comparisons."""
import json
import unittest

from analyze import analyze, episode, model_comparison, schedule
from environment import RecoveryEpisode


def fixture(design, actions, status):
    env = RecoveryEpisode(design["task"], design["seed"], design["committed"])
    try:
        steps = []
        for turn, action in enumerate(actions, 1):
            steps.append({"turn": turn, "valid": action is not None, "action": action,
                          "reply": action or "?", "observation": env.step(action) if action else None})
        return dict(design, id="fixture", steps=steps, status=status, verdict=json.loads(json.dumps(env.verify())))
    finally:
        env.close()


class TestAnalysis(unittest.TestCase):
    def setUp(self):
        self.design = next(schedule())  # refund, previous mutation absent

    def test_failed_format_and_missing_have_distinct_denominators(self):
        bad = fixture(self.design, [None] * 5, "step_limit")
        report = analyze([bad])
        self.assertEqual(report["totals"]["scheduled"], 192)
        self.assertEqual(report["totals"]["missing"], 191)
        self.assertEqual(report["totals"]["invalid_turns"], 5)
        self.assertEqual(report["totals"]["no_valid_decision"], 1)
        self.assertEqual(report["totals"]["diagnostic_eligible"], 0)
        self.assertEqual(report["by_model"][0]["pairs"], 48)
        self.assertEqual(report["by_model"][0]["both_recorded_pairs"], 0)

    def test_action_diagnostics_and_explicit_submission(self):
        bad = fixture(self.design, ["submit"], "submitted")
        self.assertTrue(episode(self.design, bad)["omission"])
        actions = ["inspect", "record_refund", "mark_refunded"]
        incomplete = fixture(self.design, actions + ["inspect", "inspect"], "step_limit")
        row = episode(self.design, incomplete)
        self.assertTrue(row["exact_state"])
        self.assertFalse(row["passed"])
        recovered = fixture(self.design, [None] + actions + ["submit"], "submitted")
        row = episode(self.design, recovered)
        self.assertTrue(row["passed"])
        self.assertFalse(row["first_inspection"])
        self.assertEqual(row["invalid_turns"], 1)
        duplicate = fixture(self.design, ["record_refund", "record_refund", "submit"], "submitted")
        self.assertTrue(episode(self.design, duplicate)["duplicate"])

    def test_inference_errors_and_corrupt_trajectories(self):
        err = fixture(self.design, ["inspect"], "inference_error")
        err["steps"].append({"turn": 2, "reply": None, "action": None, "valid": False, "observation": None})
        row = episode(self.design, err)
        self.assertFalse(row["passed"])
        self.assertEqual(row["invalid_turns"], 0)
        self.assertIsNone(row["omission"])
        self.assertEqual(row["classification"], "inference_error")
        err["steps"][0]["observation"]["result"] = []
        with self.assertRaisesRegex(ValueError, "tool observation differs"):
            episode(self.design, err)

    def test_equal_weight_clusters_retain_pairs(self):
        rows = [episode(d) for d in schedule() if d["model"] == self.design["model"]]
        for r in rows:
            r.update(passed=(r["task"] == "refund" and r["instruction"] == "inspect_first"), status="submitted")
        result = model_comparison(rows)
        self.assertEqual(result["difference"], 1 / 3)
        self.assertEqual(result["interval"], [1 / 3, 1 / 3])
        self.assertEqual(result["improvement_pairs"], 16)
        self.assertEqual(result["both_nonerror_pairs"], 48)
        self.assertEqual(result["clusters"], 12)

    def test_external_model_roster(self):
        records = []
        for i, design in enumerate(schedule(("lab/new-checkpoint",))):
            row = fixture(design, ["submit"], "submitted")
            row["id"] = f"custom-{i}"
            records.append(row)
        report = analyze(records, ["lab/new-checkpoint"])
        self.assertEqual(report["models"], ["lab/new-checkpoint"])
        self.assertEqual(report["totals"]["recorded"], 96)
        self.assertEqual(report["totals"]["missing"], 0)
        self.assertEqual(report["by_model"][0]["pairs"], 48)
        with self.assertRaisesRegex(ValueError, "Duplicate model ID"):
            analyze([], ["lab/policy", "lab/policy"])
        with self.assertRaisesRegex(ValueError, "Model IDs"):
            analyze([], [" "])
        with self.assertRaisesRegex(ValueError, "Unscheduled trial"):
            analyze(records)

    def test_duplicate_and_out_of_design_are_rejected(self):
        row = fixture(self.design, ["submit"], "submitted")
        with self.assertRaisesRegex(ValueError, "Repeated trial"):
            analyze([row, row])
        with self.assertRaisesRegex(ValueError, "Unscheduled trial"):
            analyze([{**row, "seed": 1}])


if __name__ == "__main__":
    unittest.main()
