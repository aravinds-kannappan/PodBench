import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from analyze import replay
from run import schedule
from run_policy import ExternalPolicy


HERE = Path(__file__).resolve().parent
RUNNER = [sys.executable, str(HERE / "run_policy.py"), "--model-id", "local/test-policy", "--revision", "test-v1"]
SUBMIT = "import sys,json\nfor line in sys.stdin:\n r=json.loads(line); assert r['messages'] and r['max_tokens']==12; print(json.dumps({'text':'submit'}),flush=True)"


class TestExternalPolicy(unittest.TestCase):
    def test_plan_only_has_full_grid_without_executing_policy(self):
        manifest = json.loads(subprocess.check_output([*RUNNER, "--plan-only", "--", "missing-test-program"]))
        self.assertEqual(manifest["planned_episodes"], 96)
        self.assertEqual(len({cell["id"] for cell in manifest["schedule"]}), 96)

    def test_custom_policy_uses_frozen_environment_and_preserves_output(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = Path(scratch) / "study"
            command = [*RUNNER, "--output", str(directory), "--", sys.executable, "-u", "-c", SUBMIT]
            subprocess.run(command, check=True, capture_output=True)
            journal = directory / "episodes.jsonl"
            original = journal.read_bytes()
            manifest = json.loads((directory / "manifest.json").read_text())
            rows = [json.loads(line) for line in original.splitlines()]
            self.assertEqual([row["id"] for row in rows], [cell["id"] for cell in manifest["schedule"]])
            self.assertEqual(len(rows), len(schedule()))
            for row in rows:
                self.assertEqual((row["model"], row["model_revision"]), ("local/test-policy", "test-v1"))
                self.assertEqual(row["status"], "submitted")
                self.assertFalse(replay(row)[0]["passed"])
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("already exists", result.stderr)
            self.assertEqual(journal.read_bytes(), original)

    def test_malformed_completion_reports_adapter_error(self):
        worker = ExternalPolicy([sys.executable, "-u", "-c", "input(); print('[]')"])
        try:
            with self.assertRaisesRegex(ValueError, "JSON object"):
                worker.complete([{"role": "user", "content": "Choose an action."}])
        finally:
            worker.close()


if __name__ == "__main__":
    unittest.main()
