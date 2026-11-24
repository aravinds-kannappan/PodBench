"""Offline consistency checks for the published likelihoods, swaps, and greedy paths."""
import importlib.util
import json
import math
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name+".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_jsonl(filename):
    return [json.loads(line) for line in (HERE / filename).read_text().splitlines()]


class RecordedScores(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = read_jsonl("../episodes.jsonl")
        cls.observed = read_jsonl("scores-decisions.jsonl")
        cls.inputs = module("scores-inputs")

    def test_complete_observed_grid_and_vocabulary(self):
        inputs = [r for episode in self.source for r in self.inputs.requests(episode, False)]
        self.assertEqual(len(inputs), 612)
        self.assertEqual(len(inputs), len(self.observed))
        for req, scored in zip(inputs, self.observed, strict=True):
            self.assertEqual((req["episode_id"],req["turn"]),(scored["episode_id"], scored["turn"]))
            self.assertEqual(scored["scoring_version"],"cold-prefix-v2")
            self.assertEqual(req["input_tokens"],scored["prefix_tokens"])
            self.assertEqual(req["menu"],list(scored["candidates"]))
            top = scored["top_tokens"]
            self.assertEqual(len({t["id"] for t in top}),10)
            probs = [t["probability"] for t in top]
            self.assertTrue(all(0 < p <= 1 for p in probs))
            self.assertEqual(probs,sorted(probs,reverse=True))
            self.assertLessEqual(sum(probs),1.00001)
            dist = [math.exp(x["logprob"] - scored["menu_logmass"]) for x in scored["candidates"].values()]
            self.assertAlmostEqual(sum(dist),1)
            self.assertAlmostEqual(-sum(p * math.log(p) for p in dist),scored["menu_entropy_nats"])
            for score,p in zip(scored["candidates"].values(),dist,strict=True):
                self.assertAlmostEqual(score["menu_probability"],p)
                self.assertAlmostEqual(sum(score["token_logprobs"]),score["logprob"])
                self.assertEqual(len(score["token_ids"]),len(score["token_logprobs"]))
                self.assertGreaterEqual(len(score["token_ids"]),2)

    def test_hidden_world_gives_same_first_decision_distribution(self):
        by_work_order = {}
        for row in self.observed:
            if row["turn"] != 1:
                continue
            key = tuple(row[k] for k in ("model", "task", "seed", "instruction", "menu_order"))
            by_work_order.setdefault(key, {})[row["committed"]] = row
        self.assertEqual(len(by_work_order), 96)
        for worlds in by_work_order.values():
            self.assertEqual(set(worlds), {False, True})
            self.assertEqual(worlds[False]["top_tokens"], worlds[True]["top_tokens"])
            self.assertEqual(worlds[False]["candidates"], worlds[True]["candidates"])

    def test_counterfactual_changes_only_latest_inspect_result(self):
        original = {(r["episode_id"],r["turn"]):r for e in self.source for r in self.inputs.requests(e,False)}
        requests = [r for e in self.source for r in self.inputs.requests(e,True)]
        scores = read_jsonl("scores-swaps.jsonl")
        self.assertEqual(len(requests),128)
        for changed, exported in zip(requests,scores,strict=True):
            key=changed["episode_id"], changed["turn"]
            self.assertEqual(key,(exported["episode_id"],exported["turn"]))
            unmodified=original[key]["messages"]
            modified=changed["messages"]
            self.assertEqual(modified[:-1],unmodified[:-1])
            self.assertEqual(modified[-2]["content"].strip(),"inspect")
            self.assertEqual(modified[-1]["role"],unmodified[-1]["role"])
            self.assertEqual(modified[-1]["content"].split("\nAction menu:")[1],
                             unmodified[-1]["content"].split("\nAction menu:")[1])
            self.assertEqual(exported["observation_changed"],modified[-1]!=unmodified[-1])

    def test_numerical_controls_and_file_hashes(self):
        qa = module("scores-qa")
        controls = read_jsonl("scores-branch-controls.jsonl")
        self.assertEqual({(r["episode_id"],r["turn"]) for r in controls},
                         {(r["episode_id"],r["turn"]) for r in qa.controls()})
        actual = qa.replicate_check(self.observed,read_jsonl("scores-swaps.jsonl"),controls)
        self.assertEqual(actual,json.loads((HERE/"scores-numerics.json").read_text()))
        for model, expected in (("qwen2.5-0.5b",10),("smollm2-360m",28)):
            metrics = actual[model]
            self.assertEqual(metrics["identical_observed_and_swapped_inputs"]["n"],expected)
            self.assertEqual(metrics["full_reset_each_candidate"]["n"],6)
            for control in metrics.values():
                self.assertEqual(control["max_tv"],0)
                self.assertEqual(control["max_abs_token_logprob_delta"],0)
                self.assertEqual(control["max_abs_sequence_logprob_delta"],0)
                self.assertEqual(control["top_ten_order_changes"],0)
                self.assertEqual(control["max_shared_top_ten_probability_delta"],0)
        self.assertEqual(module("scores-manifest").manifest(),json.loads((HERE/"scores-manifest.json").read_text()))

    def test_summary_and_greedy_paths(self):
        summarize=module("scores-summarize")
        swaps=read_jsonl("scores-swaps.jsonl")
        greedy=read_jsonl("scores-greedy.jsonl")
        self.assertEqual(len(greedy),len(self.observed))
        for recorded,reconstructed in zip(self.observed,greedy,strict=True):
            self.assertEqual((recorded["episode_id"],recorded["turn"]),(reconstructed["episode_id"],reconstructed["turn"]))
            path=reconstructed["greedy_path"]
            self.assertEqual(path["matches_reply"],path["decoded"]==recorded["reply"])
            self.assertAlmostEqual(sum(path["token_logprobs"]),path["logprob"])
        self.assertEqual(summarize.audit_paths(self.observed,greedy),
                         json.loads((HERE/"scores-audit.json").read_text()))
        self.assertEqual(summarize.build(self.observed,swaps),
                         json.loads((HERE/"scores-summary.json").read_text()))


if __name__ == "__main__":
    unittest.main()
