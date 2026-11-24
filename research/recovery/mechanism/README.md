# Recovery mechanisms

**Exploratory (not preregistered)**

This directory extends the frozen [recovery study](../PROTOCOL.md). The archive and the original verifier keep their original definitions. The new result tables describe different measurements on old prefixes, newly generated counterfactual trajectories, and interventions on original Hugging Face checkpoints. Keep the unit and denominator with each comparison. The site presents the frozen and exploratory studies together.

| Research question | Inputs and outputs | Reproduction |
| --- | --- | --- |
| Where did the recorded actions lead? | [One row per episode](trace_episodes.csv), [combined decisions](decisions.csv), [decoded-row schema](schema.json) | [Trace definitions and exclusive label precedence](trace_notes.md) |
| How did each instruction change candidate scores? | [Ranked vocabulary tokens](first_tokens.csv), [full menu action scores](action_scores.csv), [condition summaries](scores-summary.json) | [Scoring recipe and interpretation](scores-method.md) |
| Would changing one decision rescue an episode? | [Complete branches](forcing.jsonl), including ineligible prefixes | [Two policies and two denominators](forcing.md) |
| What happens when the prompt or a tool observation changes? | [Matched black-box estimates](blackbox/results.json) | [Fixed perturbation panel and collection](blackbox/README.md) |
| Where do the original-weight models change their choices? | [White-box results](whitebox/results.json) | [Original-weight protocol](whitebox/protocol.md) |
| Do human reviewers agree on the failure? | [Blind review kit](../site/public/review/index.html) | [Review tools](review/) |
| Which evidence supports the paper and posts? | [Research writing and claim sources](writing/) | [Static site and verification](../site/README.md) |

The combined decision table uses the archived episode ID and one-based turn as its primary key. The archive contains the unchanged raw strings. The two long-form score tables add a menu action or first-token rank to that key. A blank forcing verdict means there was no qualifying action for that policy under the remaining budget. Zero is an observed count. The review kit distinguishes missing annotations from measured disagreement.

## Start without model weights

Run these commands from the repository root with Python 3.11 or later. The trace tests check the exact serialized archive. The analysis and site checks work on the measured files in this release.

```sh
python3 -m unittest discover -s research/recovery/mechanism -p 'test_*.py'
python3 -m unittest discover -s research/recovery/mechanism/review -p 'test_*.py'
python3 research/recovery/mechanism/trace_extract.py
python3 research/recovery/mechanism/assemble.py
python3 research/recovery/site/make_site_data.py --check
node research/recovery/site/build.mjs
```

The software and synthetic data use the [repository license](../../../LICENSE). Weight downloads are external and pinned in the study manifests. The full study never requires a key or a live database. Recomputing model outputs requires the explicitly named weights and inference libraries described in each linked protocol.

For new work, copy the input manifests to a fresh collection directory, pick fixtures without consulting outcomes, and record which changes were selected after inspecting this dataset. The protocol distinguishes the two possible states of a single interrupted write. New cases with concurrent writers, a repair action, durable operation IDs, or different termination rules have different reachable states. Report those design changes alongside the results.
