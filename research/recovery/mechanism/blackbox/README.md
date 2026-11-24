# Black-box recovery probes

**Exploratory (not preregistered)**

This exploratory study changes the information available to a worker resuming an interrupted SQLite write. The primary panel fixes the refund fixture at seed 11 and crosses two checkpoints with both possible commit outcomes. Each variant has four episodes. A checkpoint-specific difference therefore has only two matched cases. These controls characterize behavior on this fixture.

## Schedule and controls

- Ten verify-first sentences have ten neutral sentence controls about gallery displays or stationery. Each pair has equal character length and equal token count under the checkpoint’s tokenizer. The collector uses the matched control for each wording. The summary also compares each active wording to the unchanged prompt. The tokenizer-only matching program selects neutral vocabulary using a fixed seed before any study responses are collected.
- Position and strength vary a single reference instruction by moving it to the user, repeating it throughout the history, capitalizing it, or giving a reason. Other presentation conditions rename actions, select actions by number, or append inert clock and label actions. Aliases preserve the SQL bindings. The two added actions return fixture metadata and consume a turn.
- Handoff variants remove the name and uncertainty detail of the previous operation, disclose its confirmed outcome, give conflicting reports, assert commit, assert rollback, append irrelevant stationery details, or include a fixed prior-worker note suggesting immediate submission. False-claim cases can be identified from the recorded hidden state. The action menu is always the authority for available operations.
- After the first inspection, four variants display the opposite initial-world observation (with earlier named operations replayed), set the reported refund count to three, retain only the order status, or add a fixed desk note suggesting submission. The database and verifier always use the unaltered state. These comparisons run twice. In the natural rollout the model must choose inspect. In the supplied-inspection rollout the controller inserts one inspect action, consumes one turn, and compares the model’s remaining four choices with an identical unaltered-inspection control. The first autonomous action in this comparison follows the supplied inspection.
- On Qwen alone, all 24 refund orders, 24 inventory orders and 120 transfer orders run independently on the committed seed-11 fixture. Each permutation is compared to canonical order in that family. Each permutation has one matched case. SmolLM2 and the other fixture seeds and commit state have no permutation sweep.

Each run uses greedy decoding, a 12-token reply limit and at most five actions, with fresh SQLite state. Only an exact displayed option after stripping outer whitespace executes a command. A malformed response consumes one turn. The frozen parent experiment supplies responses only where the full chat history, checkpoint and decoding budget match exactly. New completions with identical inputs can also be reused. A cached decision never reuses a database observation. Each trajectory executes its own tool calls.

## Reproduction

Use the same Node package and GGUF paths as the parent study. From the repository root, with the CPU runtime’s node_modules on NODE_PATH, run the following commands. Supply a new output directory on the first invocation. To resume an interrupted collection, add --resume with the same output directory and identical code and weights.

```sh
python3 research/recovery/mechanism/blackbox/collect.py \
  --qwen-gguf "$QWEN_GGUF" --smollm-gguf "$SMOLLM_GGUF" \
  --output /tmp/podbench-blackbox
python3 research/recovery/mechanism/blackbox/summarize.py --directory /tmp/podbench-blackbox
```

The matched sentences are included in placebos.json. To regenerate them, run `node research/recovery/mechanism/blackbox/match-placebos.mjs "$QWEN_GGUF" "$SMOLLM_GGUF"`. The summary verifies that the observed, fully formatted first prompts in each active/placebo pair had equal input-token counts.

Each trajectory in traces.jsonl links its autonomous steps to a SHA-256 key in decisions.jsonl. Each unique decision contains the full messages, raw completion, input and output token counts, and an original episode ID and turn if reused from the parent archive. Forced inspection is labeled separately. True tool observations and the displayed results are both retained.

In results.json, control and treatment give matched counts. The percentage-point delta is 100 × (treatment − control) / n. Gained and lost count the two directions of change. The exact-state metric requires every SQLite endpoint; verified completion additionally requires submission. For observation probes, immediate submission after inspect is scored only when the worker made a subsequent choice in both arms. A zero denominator yields a null delta. All counts are descriptive.

The permutation summaries count choices across distinct menu layouts, including the number that selected the first displayed option. The only unit varied in this grid is menu order, so these counts describe order sensitivity for one model and fixture.
