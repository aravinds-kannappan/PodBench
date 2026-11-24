"""Regression tests for the exploratory SQLite replay and the two reachability endpoints."""
import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from trace_extract import LABELS, RECOVERY, Reachability, collect, database_diff, extract, frozen_bytes, loop_period, target_state, write_csv


class TestArchive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = {row["id"]: row for row in map(json.loads, (RECOVERY / "episodes.jsonl").read_bytes().splitlines())}
        episodes, cls.decisions = collect(RECOVERY / "episodes.jsonl")
        cls.episodes = {row["id"]: row for row in episodes}

    def test_reconstructed_journal_bytes(self):
        # Rebuild whole lines in the frozen serializer, including the original observations.
        steps = {(row["id"], row["turn"]): row for row in self.decisions}
        archived = (RECOVERY / "episodes.jsonl").read_bytes()
        rebuilt = bytearray()
        for line in archived.splitlines():
            record = json.loads(line)
            for turn in record["steps"]:
                derived = steps[record["id"], turn["turn"]]
                turn.update(action=derived["action"], valid=derived["parse_succeeded"], observation=derived["observation"])
            rebuilt.extend(frozen_bytes(record))
        self.assertEqual(bytes(rebuilt), archived)

    def test_detects_altered_observation_and_verdict(self):
        line = (RECOVERY / "episodes.jsonl").read_bytes().splitlines()[0]
        for field in ("observation", "verdict"):
            record = json.loads(line)
            if field == "observation":
                record["steps"][0][field]["sql"] = "corrupted"
            else:
                record[field]["endpoints"]["archive_once"] = None
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "archived bytes"):
                extract(frozen_bytes(record), Reachability(), target_state(record["task"], record["seed"]))

    def test_labels_and_diffs_match_frozen_verifier(self):
        for key, row in self.episodes.items():
            source = self.raw[key]
            self.assertIn(row["failure_label"], LABELS)
            self.assertEqual(row["exact_state"], not bool(row["final_diff"]))
            self.assertEqual(row["exact_state"], all(source["verdict"]["endpoints"].values()))
            self.assertEqual(row["exact_and_submitted"], source["verdict"]["passed"])

    def test_duplicate_has_no_repair(self):
        key = "qwen2.5-0.5b.refund.11.committed.baseline.canonical"
        steps = [d for d in self.decisions if d["id"] == key]
        self.assertEqual(steps[0]["force_oracle"], "mark_refunded")
        self.assertEqual(steps[0]["force_evidence"], "inspect")
        self.assertTrue(steps[0]["crossed_exact"])
        self.assertEqual(steps[1]["viable_next"], {})
        self.assertIsNone(steps[1]["force_oracle"])

    def test_state_and_submission_have_distinct_deadlines(self):
        row = self.episodes["smollm2-360m.refund.11.committed.baseline.canonical"]
        self.assertIsNone(row["first_unreachable_exact"])
        self.assertEqual(row["first_unreachable_submission"], 5)
        self.assertEqual(row["failure_label"], "exact state without submit")

    def test_candidate_distances_and_evidence(self):
        for step in self.decisions:
            routes = step["viable_next"]
            if routes:
                self.assertEqual(routes[step["force_oracle"]], min(routes.values()))
                self.assertLessEqual(max(routes.values()), step["remaining_before"])
            if step["ambiguous_before"]:
                self.assertEqual(step["evidence_proposal"], "inspect")
            if step["force_evidence"]:
                self.assertIn(step["force_evidence"], routes)

    def test_period_and_multisets(self):
        self.assertEqual(loop_period(["a", "b", "a", "b"]), 2)
        self.assertEqual(loop_period(["a", None, None]), 0)
        self.assertEqual(database_diff({"t": ((3,), (3,))}, {"t": ((3,),)}), {"t": {"extra": [(3,)], "missing": []}})

    def test_output_bytes_and_schema_columns(self):
        schema = json.loads((HERE / "trace_schema.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            for name, records in (("episode", list(self.episodes.values())), ("decision", self.decisions)):
                output = Path(directory) / "out.csv"
                write_csv(output, records)
                self.assertEqual(output.read_bytes(), (HERE / f"trace_{name}s.csv").read_bytes())
                with output.open() as stream:
                    self.assertEqual(set(next(csv.reader(stream))), set(schema["$defs"][name]["required"]))


if __name__ == "__main__":
    unittest.main()
