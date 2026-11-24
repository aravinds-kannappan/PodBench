# Inspecting the recovery decision in the original checkpoints

**Exploratory (not preregistered)**

This exploratory follow-up uses the original bfloat16 Hugging Face weights for Qwen2.5-0.5B-Instruct and SmolLM2-360M-Instruct. The archived recovery run used Q4_K_M GGUF weights on a different backend. The ordinary SQLite tasks provide a benign target for these measurements. The held-out fixture split, within-model pairs, reference action, classifier control and intervention scope are defined in the [protocol](protocol.md).

Run the commands from this directory in a fresh Python 3.12 environment. The model downloads require approximately 1.7 GB. The Transformers run uses local files after download. A feature cache contains intermediate tensors for reuse across the two analysis stages. Use caches you produced yourself.

```sh
python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.7.1
python -m pip install -r requirements.txt
python fetch_weights.py /tmp/recovery-hf-weights
export OPENBLAS_NUM_THREADS=1
export TOKENIZERS_PARALLELISM=false
for model in qwen2.5-0.5b smollm2-360m; do
  python features.py --model "$model" --weights /tmp/recovery-hf-weights --cache "/tmp/$model.pt"
  for stage in readouts interventions; do
    python collect.py --stage "$stage" --weights /tmp/recovery-hf-weights --cache "/tmp/$model.pt" --output records
  done
  python vocab_lens.py --cache "/tmp/$model.pt" --weights /tmp/recovery-hf-weights --output records
  python feature_archive.py export "/tmp/$model.pt" "records/$model/decision-residuals.npz"
done
python merge.py
```

The merge produces `results.json`. Each checkpoint's `records/` directory contains one JSON line per teacher-forced record, one per held-out layer/probe prediction group, one per patch, and one per steering rollout. The human-readable model IDs in the JSONL record keys join back to `../../episodes.jsonl`. Duplicate hidden worlds are counted once for each distinct first-decision prompt in the numerical HF/GGUF comparison. That comparison also joins the GGUF inspect-token log probability in `../scores-decisions.jsonl`. The two probability calculations normalize over the full vocabulary. The logit lens restricts the readout to the distinct first token IDs of actions on the menu.

For each target, the classifier uses one-hot labels, the training-feature mean and standard deviation, a square-root-width normalization, and a dual ridge solution with a unit diagonal penalty and a fitted intercept. It sees held-out labels only for scoring. Its shuffled control permutes training labels once per target with a fixed seed, preserving class counts. Consult the majority baseline and target support when interpreting accuracy. Inputs that share a work order or conversation are correlated. The archived label for the next operation uses the expected authorized update from ground-truth state, so the model need not have seen enough identifying evidence to achieve perfect accuracy.

Run `python check.py` without PyTorch or model weights to verify the published record hashes, held-out split and labels, layer-level probe and patch tallies, steering dose grid and SQL terminal states.

### Interpretation

The teacher-forced contexts inherit the actions of the GGUF model, including unparseable replies. They need not lie on the original checkpoint's own greedy trajectory. The agreement panel quantifies that mismatch at the first decision. It reports exact replies, matching valid action names over all 12 texts, and concordance among pairs where both replies named a legal action. Identical inputs across hidden worlds cannot distinguish the initial commit state.

A classifier can read the literal system instruction or the position and wording of an earlier tool result. Decodability therefore has a different interpretation from use in action selection. Attention mass also depends on span length. The patch moves a vector at a single decision position between prompts of different lengths; it tests that particular substitution. Neither a local margin shift nor a full-response patch transfer establishes a unique circuit. The midpoint steering experiment evaluates later changes through actual SQL actions. Its five fixed coefficients, single held-out fixture seed and one injection position leave other layers, doses and workflows unmeasured.

The [execution manifest](manifest.json) lists the verified SHA-256 of every original HF model/configuration/tokenizer file, collector and input hashes, CPU/library versions, split and permutation seeds, and the intermediate tensors' disposition. To refresh it after a complete run, use the same Python environment and pass the two caches produced above.

```sh
python manifest.py --weights /tmp/recovery-hf-weights \
  --qwen-cache /tmp/qwen2.5-0.5b.pt --smol-cache /tmp/smollm2-360m.pt
```

Exact logit ties in the restricted menu readout resolve to the first displayed menu entry. Full-vocabulary greedy decoding breaks ties by token ID. These choices can disagree even when a menu token attains the highest vocabulary logit. Treat the full generated action as the behavioral measurement.

### Refit the probes without model weights

Each checkpoint's `decision-residuals.npz` contains one three-dimensional array of exact decision-position BF16 bit patterns, stored as unsigned 16-bit integers. The axes are unique input context, decoder block (one-based labels in `layer`) and hidden feature. `context_index` maps each decision row to a context. The other arrays carry episode ID, turn, fixture seed, train/test split, task, menu order and labels. An empty canonical action marks an irreparable state that is excluded from that probe. Context hashes join to the per-record readouts. All arrays use numeric, boolean or fixed-width Unicode dtypes and load with `allow_pickle=False`. The website serves the summary; the downloadable feature archives live in the repository.

With NumPy 2.2.6 installed, these commands refit all four targets at every layer and compare their scores to the published summaries. They do not import PyTorch or Transformers.

```sh
export OPENBLAS_NUM_THREADS=1
for model in qwen2.5-0.5b smollm2-360m; do
  python feature_archive.py refit "records/$model/decision-residuals.npz" \
    --check "records/$model/readout-summary.json"
done
```

### Unrestricted token readout

A supplementary logit lens applies the same final normalization and original output matrix to each saved decision vector over the entire vocabulary. It records the unrestricted top token ID, decoded text, its probability and the probability of the initial inspect token at each block. The per-layer summary weights a cached context by its number of archived decision rows. The summary also compares the final-block batched readout to the original forward's argmax and inspect probability. Read the raw vectors in `vocab-lens.jsonl` alongside the menu-restricted readout in `readouts.jsonl`. An unrestricted top token can be punctuation, a subword, or the beginning of an action.
