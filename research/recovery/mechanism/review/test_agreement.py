"""Artificial labels for mathematical and input-validation tests, never public study data."""
import json
import tempfile
import unittest
from pathlib import Path
from agreement import cohen, fleiss, read_annotations, summarize


class TestAgreement(unittest.TestCase):
    def test_cohen(self):
        self.assertEqual(cohen([("a","a"),("b","b")])["kappa"], 1)
        self.assertEqual(cohen([("a","b"),("b","a")])["kappa"], -1)
        self.assertIsNone(cohen([("a","a"),("a","a")])["kappa"])
        self.assertIsNone(cohen([])["kappa"])

    def test_fleiss(self):
        self.assertEqual(fleiss([["a"]*3, ["b"]*3], 3)["kappa"], 1)
        self.assertAlmostEqual(fleiss([["a","b","a"], ["b","a","b"]], 3)["kappa"], -1/3)

    def test_missing_and_confusion(self):
        key = {"one":"x", "two":"y", "three":"z"}
        source = {"alice":{"one":{"failure_label":"x"}, "two":{"failure_label":"y"}},
                  "bob":{"one":{"failure_label":"y"}, "three":{"failure_label":"z"}}}
        report = summarize(source, key)
        matched = report["rubric"]["failure_label"]
        self.assertEqual(matched["pairwise_cohen"][0]["n"], 1)
        self.assertEqual(matched["fleiss_complete_panel"]["n"], 1)
        self.assertEqual(len(report["disagreements"]), 1)
        self.assertEqual(sum(x["count"] for x in report["confusion"]), 4)
        self.assertNotIn("alice", json.dumps(report))
        self.assertEqual(summarize({}, key)["status"], "awaiting annotations")

    def test_reject_unknown_kit_duplicate_and_invalid(self):
        kit = {"kit_id":"test", "cases":[{"case_id":"one"}]}
        base = {"kit_id":"test","schema_version":1,"annotator_id":"reader","ratings":{"one":{"evidence":"yes"}}}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "export.json"
            path.write_text(json.dumps(base))
            self.assertEqual(read_annotations([path], kit)["reader"]["one"]["evidence"], "yes")
            with self.assertRaises(ValueError):
                read_annotations([path,path], kit)
            for patch in ({"kit_id":"bad"}, {"ratings":{"one":{"severity":"typo"}}}, {"ratings":{"bad":{}}}):
                path.write_text(json.dumps({**base,**patch}))
                with self.assertRaises(ValueError):
                    read_annotations([path], kit)
