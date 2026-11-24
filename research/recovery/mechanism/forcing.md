# One corrected decision

**Exploratory (not preregistered)**

For every archived decision, this experiment restores the database, earlier replies and model-visible feedback from the start of that episode. It substitutes one exact action name for the current reply and resumes the same checkpoint greedily, including invalid replies and the original five-turn budget. The final verifier runs on a fresh in-memory database for each intervention. A forced submit terminates the branch immediately. Stored results give every attempted branch, every later action and tool observation, and the final verdict.

The shortest-path oracle knows the true initial world. It takes the first action on a shortest path to exact submission. The evidence-respecting policy inspects whenever both worlds still explain the visible observations. Once the history distinguishes them, it takes a shortest feasible continuation. The [trace specification](trace_notes.md) gives the tie rule and the viability search. Some prefixes have no repair remaining. Others admit an oracle action with too little time to inspect first. We record both cases as ineligible for the corresponding policy. A conditional success rate divides by eligible interventions. The all-prefix rate divides by all archived decisions at that turn and counts ineligible interventions as yielding no verified rescue. Prefixes are repeated measurements within an episode.

The first decision on a branch is externally selected. A successful branch measures what happens when one particular decision is replaced. Choosing that action can change every subsequent message. This intervention does not establish that a model knows which action should be forced, or that inspecting improves outcomes.

From the repository root, use the pinned node-llama-cpp installation and exact GGUFs described in the [frozen guide](../README.md). Set NODE_PATH to that installation's node_modules directory. Supply a directory containing the two GGUFs under their manifest filenames, or named qwen.gguf and smollm2.gguf.

```sh
python3 research/recovery/mechanism/trace_extract.py
python3 research/recovery/mechanism/force.py --weights /path/to/weights --cache /tmp/podbench-forcing-v1.jsonl
python3 research/recovery/mechanism/assemble.py
```

The SHA-256 key for a cached completion includes the model ID and every role and message in the prefix. The collector verifies model digests at startup. An exact match to a frozen history reuses its recorded deterministic reply. Other prefixes use the frozen generator with its original ChatML representation, seed and twelve-token reply cap. Repeated identical inputs reuse their measured greedy output. Keep a cache specific to the model digests and runtime in the manifest.

The decision and episode tables use one row per archived unit. The action-score table has one row per menu option per decision. The first-token table has one row per rank per decision. Candidate sequence probabilities include the ChatML terminator and use canonical tokenization. The normalized menu score conditions on those sequences. A normalized menu entropy or rank does not describe the probability of all rejected natural-language answers or alternative tokenizations. The raw vocabulary top tokens expose some of that distinction.
