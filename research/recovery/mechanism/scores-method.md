# How to reproduce the score replay

**Exploratory analysis of the original 192 SQLite recovery episodes.** The 612 decision prefixes include the tool messages, invalid replies and retry feedback archived by the collector. The first decision of a pair of commit states has the same visible prefix. Keep model, task, seed, hidden state, menu order and instruction in the join key. Forcing an action for likelihood measurement here does not execute that action in the original environment. [Raw journal](../episodes.jsonl) · [Checkpoint and runtime manifest](../manifest.json)

## What a score means

For a decision prefix, the evaluator tokenizes each action name independently using the model’s canonical tokenizer and appends the ChatML token `<|im_end|>`. It computes natural log probability by summing the full-vocabulary conditional log probability of every token, including that terminator. Longer names contribute more factors. Raw log probabilities and the score of `submit` remain available in `candidates[action].logprob`. The ten highest-probability first tokens are stored with both token IDs and detokenized labels. Their probabilities use an untruncated vocabulary softmax at temperature one. Collection used greedy decoding. [Evaluator](scores-evaluate.mjs) · [Decision measurements](scores-decisions.jsonl)

`menu_probability` divides a candidate’s sequence probability by the sum of the scored probabilities over the current menu. `menu_logmass` gives the log of that sum. Other strings, whitespace variants and alternative tokenizations of the same characters can take the rest of the vocabulary mass. `menu_entropy_nats` is the Shannon entropy on the normalized menu. `margin_nats` subtracts the runner-up’s sequence log probability from the highest value. The probability assigned to a legal response and the action produced by greedy free generation answer different questions. [Decision measurements](scores-decisions.jsonl)

The collector archived decoded replies and token counts. `logged_continuation` measures the canonical retokenization of the logged reply, including an end-of-turn marker for replies that ended naturally. A length-limited reply is scored without appending a marker. The separate greedy audit reconstructs the vocabulary path using the original prefix and records the probability of each successive argmax token. Its `matches_reply`, `matches_length` and `matches_finish` flags compare the reconstruction with the archive. Only a match on all three supports attributing this reconstructed likelihood to the logged decision. [Greedy-path audit](scores-greedy.jsonl)

## Replacing one observation

Every archived next decision immediately after a valid inspection is eligible. Replay the same valid preceding actions against a fresh SQLite fixture whose initial commit bit is reversed. Replace just the latest inspection result with the new reading. Keep the original assistant replies, earlier feedback, user request, action bindings and menu order. The intervention measures local response sensitivity even when the replacement is inconsistent with observations *earlier* in a long history. It does not sample a new episode. The two probability distributions in each comparison use the same action menu. Their total variation distance is half the sum of absolute differences across actions. [Input reconstruction](scores-inputs.py) · [Swapped scores](scores-swaps.jsonl)

All later-turn descriptions are conditional on the original policy reaching that turn. An episode can produce more than one inspection comparison. The first-token summaries across decisions give each vocabulary token only the probability captured in the top ten on each prefix; averages are lower bounds when the token drops out of those ten. [Summaries](scores-summary.json)

## Run offline with the pinned weights

Use the two SHA-256-verified GGUF files and `node-llama-cpp@3.16.2` described in the replication guide. The runtime uses two CPU threads, a 4,096-token context, batch size 256, and the original ChatML framing. The scorer checks each original prefix against its archived input token count. Set `NODE_PATH` if the runtime was installed in a separate npm prefix. [Recovery replication guide](../README.md)

From the repository root, use new output paths for a clean run. The evaluator can also resume a shard by episode ID and turn. Retain a shard for the same input, model, scoring mode and source revision when resuming.

```sh
SCORE_DIR="$(mktemp -d)"
MECH=research/recovery/mechanism
python3 "$MECH/scores-inputs.py" > "$SCORE_DIR/original.jsonl"
python3 "$MECH/scores-inputs.py" --swaps > "$SCORE_DIR/swap-inputs.jsonl"

# QWEN_GGUF and SMOLLM_GGUF point to the downloaded study files.
for MODEL in qwen smollm; do
  if [ "$MODEL" = qwen ]; then
    ALIAS=qwen2.5-0.5b
    WEIGHTS="$QWEN_GGUF"
  else
    ALIAS=smollm2-360m
    WEIGHTS="$SMOLLM_GGUF"
  fi
  node "$MECH/scores-evaluate.mjs" "$ALIAS" "$WEIGHTS" "$SCORE_DIR/original.jsonl" "$SCORE_DIR/podbench-$MODEL-scores.jsonl"
  node "$MECH/scores-evaluate.mjs" "$ALIAS" "$WEIGHTS" "$SCORE_DIR/original.jsonl" "$SCORE_DIR/podbench-$MODEL-greedy.jsonl" greedy
  node "$MECH/scores-evaluate.mjs" "$ALIAS" "$WEIGHTS" "$SCORE_DIR/swap-inputs.jsonl" "$SCORE_DIR/podbench-$MODEL-swaps.jsonl"
done
for KIND in scores greedy swaps; do
  python3 "$MECH/scores-merge.py" --parts "$SCORE_DIR" --kind "$KIND"
done
python3 "$MECH/scores-summarize.py"
python3 "$MECH/explain.py"
python3 -m unittest discover -s "$MECH" -p 'scores_test.py'
```

Run outputs can differ slightly across CPU implementations. Compare the saved log probabilities and argmax choices as well as the archive joins. The merge checks verify complete decision coverage, token-path lengths, menu normalization and ranking before writing the public files. [Merge checks](scores-merge.py)
