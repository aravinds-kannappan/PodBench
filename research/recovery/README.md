# Reproducing the recovery study

PodBench hands a worker an unfinished transaction with a lost acknowledgement. For each work order the visible handoff is identical in two worlds. In one world the previous write committed. In the other the database still needs that write. The worker can inspect persisted state, issue named SQL writes and submit. SQLite commits each successful write immediately. [Prospective protocol](PROTOCOL.md) · [Research report](REPORT.md)

Run the commands below from the repository root. The environment, reference policies and analysis use Python 3.10 or later. Model collection requires Python 3.11 or later, Node.js 20 or later, a Unix-like environment, the CPU inference package and two GGUF weight files.

## Check the environment without downloading model weights

```sh
python3 -m unittest discover -s research/recovery -p 'test_*.py' -v
python3 research/recovery/baselines.py
python3 research/recovery/baselines.py --task refund --seed 11 --json
```

The unit tests exercise the verifier, including collateral changes, omitted reconciliation and submission. The baseline command checks all 24 initial states (three tasks, four fixture seeds, two commit outcomes) against each policy. The single-seed command prints the six complete controller traces for a single fixture as JSON Lines. Each step records the selected action, the bound SQL and the observation returned by SQLite. The verdict includes the final database observations and individual endpoint checks.

| Reference policy | Previous write absent | Previous write committed | All states |
| --- | ---: | ---: | ---: |
| Inspect, then issue only missing work | 12/12 | 12/12 | 24/24 |
| Always repeat the uncertain write | 12/12 | 0/12 | 12/24 |
| Always assume the write committed | 0/12 | 12/12 | 12/24 |

These are deterministic controller checks. Each blind controller completes the later operations and submits. In the world where it repeats a committed write, the refund ledger has two entries, inventory receives the shipment twice, or the transfer archive has two copies. In the world where it skips a missing write, the later completion markers conceal an absent refund, stock adjustment or archive copy. The inspect-first controller reads the same SQLite observation available to the model. The initial prompt and action menus must match across the two worlds. The suite also checks for SQL errors and completion within the five-decision budget. [Reference policy implementation](baselines.py)

## Recompute the published model results

The journal stores one record per collected model episode with decisions and observations. The standard-library analysis replays the selected SQL actions, computes the scheduled denominators and exports summaries plus a CSV of episode-level results. Use a temporary output directory to compare a reconstruction with the published artifacts.

```sh
RECOVERY_WORK=$(mktemp -d)
python3 research/recovery/analyze.py \
  --journal research/recovery/episodes.jsonl \
  --output "$RECOVERY_WORK/recovery-results.json" \
  --csv "$RECOVERY_WORK/recovery-episodes.csv"
cmp docs/recovery-results.json "$RECOVERY_WORK/recovery-results.json"
cmp docs/recovery-episodes.csv "$RECOVERY_WORK/recovery-episodes.csv"
```

## Collect another run with the two pinned checkpoints

The CPU generator uses `node-llama-cpp@3.16.2` and verifies the SHA-256 of each downloaded GGUF before inference. Use the same runtime for both conditions. Run the commands below in the same shell. The two downloaded model files and optional inference runtime stay in a temporary workspace.

```sh
RECOVERY_WORK=$(mktemp -d)
npm install --prefix "$RECOVERY_WORK/runtime" node-llama-cpp@3.16.2
export NODE_PATH="$RECOVERY_WORK/runtime/node_modules"
for model in qwen2.5-0.5b smollm2-360m; do
  node scripts/local-completion.mjs --model "$model" --metadata > "$RECOVERY_WORK/$model.json"
  url=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$RECOVERY_WORK/$model.json")
  curl -fL "$url" -o "$RECOVERY_WORK/$model.gguf"
done
python3 research/recovery/run.py \
  --qwen-gguf "$RECOVERY_WORK/qwen2.5-0.5b.gguf" \
  --smollm-gguf "$RECOVERY_WORK/smollm2-360m.gguf" \
  --output "$RECOVERY_WORK/collection"
python3 research/recovery/analyze.py \
  --journal "$RECOVERY_WORK/collection/episodes.jsonl" \
  --output "$RECOVERY_WORK/summary.json" --csv "$RECOVERY_WORK/episodes.csv"
```

The output directory must be new. If collection is interrupted, repeat the same command with `--resume`. The driver checks its manifest and skips completed cells. Each complete collection contains `manifest.json`, individual episode files in `journal/` and the merged `episodes.jsonl`.

The full grid crosses checkpoints, tasks, fixture seeds, commit outcomes, prompt instructions and menu orders. Report each checkpoint separately. A replication can compare endpoint counts and paired differences with the archived run and retain every discrepant action sequence. [Inference settings and model revisions](../../scripts/local-completion.mjs) · [Collection driver](run.py) · [Analysis](analyze.py)

## Evaluate another model without editing the harness

Use `run_policy.py` with a model identifier, its immutable revision and a command that speaks JSON Lines on standard input and output. It uses the released collector's exact 96-cell schedule, prompt construction, menu order, parser, five-decision budget, SQLite tools and verifier. A plan-only invocation prints the cells and protocol file hashes without launching the command.

```sh
python3 research/recovery/run_policy.py --model-id my-lab/my-policy \
  --revision my-checkpoint-hash --plan-only
```

Each line sent to the subprocess contains `messages` (the full ordered chat history) and `max_tokens` (12). Return and flush one JSON line per request, for example `{"text":"inspect","input_tokens":123,"output_tokens":1,"finish_reason":"stop"}`. Token counts and finish reason are optional. Send runtime logs to stderr. The same process serves multiple episodes; base every response on the supplied history and clear any unreported state carried between requests. The collector parses the raw completion after stripping surrounding whitespace. A malformed action consumes a turn and leaves the database unchanged. A malformed response record or subprocess error becomes an inference error in the journal.

This offline example exercises the transport, verifier and analyzer with a scripted policy that always submits. To evaluate a checkpoint, replace the example executable with its adapter, change both identity fields, and use a fresh output directory.

```sh
RECOVERY_WORK=$(mktemp -d)
cat > "$RECOVERY_WORK/submit.py" <<'PY'
import json
import sys

for line in sys.stdin:
    request = json.loads(line)
    assert "messages" in request and request["max_tokens"] == 12
    print(json.dumps({"text": "submit", "finish_reason": "scripted"}), flush=True)
PY
python3 research/recovery/run_policy.py \
  --model-id scripted-submit --revision example-1 \
  --output "$RECOVERY_WORK/study" -- python3 "$RECOVERY_WORK/submit.py"
python3 research/recovery/analyze.py --model-id scripted-submit \
  --journal "$RECOVERY_WORK/study/episodes.jsonl" \
  --output "$RECOVERY_WORK/study/results.json" --csv "$RECOVERY_WORK/study/episodes.csv"
```

A new collection writes its own manifest and flushes one trace per completed episode. The manifest records the supplied revision, command arguments, schedule and evaluator source digests. Pass any provider credentials through the environment. Keep the adapter source, decoding settings and executable versions alongside the manifest when sharing results. A nonzero exit after collection reports that at least one episode encountered an inference error. The journal retains the affected cells. [External policy runner](run_policy.py) · [Frozen episode implementation](run.py) · [Analysis](analyze.py)

## Add a fixture or task family

Changing a positive seed changes the work order while preserving a family's workflow. For example, this checks all three controllers and both commit outcomes on two new inventory fixtures.

```sh
python3 research/recovery/baselines.py --task inventory --seed 7 --seed 13
```

To implement a different workflow, extend `TASKS` and add a matching `_seed_<family>` method in the environment. Define the work order and its initial SQLite rows. Map the action name `inspect` to a read that distinguishes the possible states. Put the uncertain write first among the mutation actions, then list the remaining transaction steps in their intended order. The constructor applies the uncertain write once when initializing the committed world.

Define the reference queries for protected rows in `_collateral_queries`. Add an explicit family branch in `verify` that reads the target rows and checks exact-once effects, later reconciliation, and protected state. Extend `first_write_is_missing` in the reference policies to interpret that family's inspection row. Add descriptions for its actions to the extension driver's `ACTION_DESCRIPTIONS` map. Run the conformance suite on both initial states and add a verifier test that independently breaks each new endpoint. The published study's protocol and factor grid identify its original three families. Give an extension its own protocol and results directory. [Verifier and fixture definitions](environment.py) · [Reference policies](baselines.py)

## Render the publication files

The [data dictionary](DATA.md) describes the public journal, each decision and the analysis denominators. The [runtime record](runtime.json) identifies the Python, SQLite and Node versions and the public collection revision. Reading the paper and replaying the raw decisions do not require the optional publishing tools.

To rebuild the standalone vector figure and manuscript PDF, install Matplotlib (the release used 3.10.8), Pandoc, XeLaTeX, and Liberation Serif. Run:

```sh
python3 research/recovery/figure.py
python3 research/recovery/render_report.py
```

To audit the exact model-facing inputs and match the analysis file to the raw journal, run `python3 research/recovery/check_inputs.py --results docs/recovery-results.json`.

The outputs are `docs/recovery-figure.pdf`, a PNG preview, and `docs/recovery-report.pdf`. Cite the [versioned release](https://github.com/aravinds-kannappan/PodBench/releases/tag/recovery-v1.0.0) and the checkpoint revision for each new comparison. [Software citation](../../CITATION.cff)
