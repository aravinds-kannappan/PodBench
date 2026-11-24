# Recovery study data

Each row in `episodes.jsonl` is one fresh SQLite episode. The synthetic customer IDs, emails, amounts and inventory values come from the fixture generator. No customer records, provider credentials or human participant data were collected. The previous worker is represented by a constructed database state and handoff message. There is no live second worker.

## Joining the files

| File | Unit and fields |
| --- | --- |
| [episodes.jsonl](episodes.jsonl) | One JSON object per episode. The stable `id` combines model, task, fixture seed, hidden commit state, instruction and menu order. |
| [manifest.json](manifest.json) | Checkpoint revisions and weight hashes, inference settings, schedule, and SHA-256 digests of the exact collector, SQLite environment and generator files. |
| [runtime.json](runtime.json) | Hardware and software environment, public protocol revision and collector revision. |
| [recovery-episodes.csv](../../docs/recovery-episodes.csv) | One analysis row per scheduled cell. Join by `id`; `trace_line` points to the corresponding 1-based line in the raw journal when available. |
| [recovery-results.json](../../docs/recovery-results.json) | Cell counts, model-level matched estimates and descriptive intervals, menu-order diagnostics, and selected turn fields for the explorer. `journal_sha256` identifies the input journal. |

The journal's `committed` bit and `initial_state` are grader metadata. The model sees `system`, `prompt`, then its own prior replies and the feedback saved under `next_user`. The ordered `menu` supplies the same action names in forward or reverse order. Inference has no access to the journal's outcome fields.

## Reading a turn

Each entry of `steps` records the raw decoded `reply`, accepted `action` if any, `valid`, tool `observation`, finish reason, token counts and local latency in milliseconds. The observation includes the SQL statement, returned rows or affected-row count, and any SQLite error. A valid action can encounter a database error. An invalid reply uses one turn without issuing SQL. The terminal `verdict` includes explicit submit status, per-endpoint booleans and observations of the final ledger, stock or customer state.

`submitted`, `step_limit` and `inference_error` are terminal statuses. Submission alone does not imply success. For ambiguity at the interrupted write, the verifier checks the final count or quantity as well as all required follow-up work. Flags for duplicate effects, omissions and incomplete follow-up can overlap. Read a diagnostic count with its eligible denominator. A placeholder for a missing scheduled cell in the analysis has no observed trace or behavioral outcome.

## Reuse

The released software and repository artifacts are distributed with the repository's [Apache 2.0 license](../../LICENSE). The checkpoint weights are fetched separately and remain subject to the upstream providers' terms. Cite the release, specify the model revision, and keep any new grid or parser version separately identifiable. The finite grid consists of two small quantized checkpoints and three synthetic workflows. There is no train/test split, human cohort or representative deployment sample. [Protocol](PROTOCOL.md) · [Replication guide](README.md) · [Citation metadata](../../CITATION.cff)
