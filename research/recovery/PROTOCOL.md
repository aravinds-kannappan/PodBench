# Recovery after an ambiguous write acknowledgement

## Question and prospective design

A worker loses the acknowledgement for a database operation and hands the task to a fresh agent. Does an explicit instruction to inspect persisted state before writing increase the probability that the agent finishes the work exactly once? We predict a positive difference in verified completion for the inspect-first instruction. A secondary question is whether an increase in inspection actually translates into more successful recoveries.

This is a prospective protocol for a controlled benchmark experiment. The project will record the code revision, model weights and inference settings used for collection. We will report all scheduled cells, including null effects. Earlier PodBench experiments informed this design, particularly the finding that answer order affected a smaller choice assay. The earlier episodes are excluded from this analysis.

## Experimental unit and schedule

The unit is a complete interactive episode on a fresh, synthetic, in-memory SQLite database. A controller constructs a customer-support handoff with a missing acknowledgement. The previous worker's first operation either committed or did not occur. Within each task and seed the same handoff text is used for both worlds. A read can distinguish them. The model must choose subsequent actions and submit. The fixture supplies the correct reference ledger, inventory quantity or archive state to the verifier only.

| Factor | Levels |
| --- | --- |
| SQL task family | Refund ledger insertion and reconciliation, additive inventory update and reconciliation, archive copy and source removal |
| Fixture seed | 11, 23, 37, 53 |
| Previous operation | Absent, committed |
| Instruction | Generic recovery request, same request with an explicit inspect-before-write instruction |
| Menu presentation | Canonical order, reverse order of the same named actions and SQL bindings |
| Checkpoint | Qwen2.5-0.5B-Instruct Q4_K_M and SmolLM2-360M-Instruct Q4_K_M |

The full crossing yields 192 scheduled episodes, 96 per model. Within a model and instruction there are 48 episodes. The matched unit for the instruction comparison holds family, seed, hidden state and menu order fixed. Each decision selects one of the named SQL actions or submits. Every episode starts with fresh task state and history. There are at most five model decisions per episode. Menu reversal changes presentation only.

We select the grid and settings before collecting study decisions. Installation tests may ask models to copy an unrelated token. Handwritten reference policies and environment tests may exercise all fixtures before collection. They do not count as model episodes. Use greedy decoding and fixed model-specific chat formatting. Release the exact prompts, action menu, decisions, SQL observations, model settings and verdicts. No setting is selected using model performance on these fixtures.

### Pinned weights

| Model repository | Revision | GGUF SHA-256 |
| --- | --- | --- |
| Qwen/Qwen2.5-0.5B-Instruct-GGUF | `9217f5db79a29953eb74d5343926648285ec7e67` | `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` |
| bartowski/SmolLM2-360M-Instruct-GGUF | `7be6f65f1db715fe5dc5a4634c0d459b4eed42ec` | `2fa3f013dcdd7b99f9b237717fa0b12d75bbb89984cc1274be1471a465bac9c2` |

## Reference policies and verifier

A state-inspecting reference policy provides an attainable upper bound on the finite fixtures. Two blind policies respectively retry the uncertain operation and assume it already committed. Their disagreement across worlds tests the purpose of the handoff. Conformance tests must cover duplicated effects, missing effects, incomplete reconciliation, changes to protected data and the distinction between correct state and explicit submission. Commit the harness and run the checks before model collection.

## Primary estimand and uncertainty

For each model, report the difference in the proportion of scheduled episodes with both exact verified end state and explicit submission, inspect-first minus generic. Report both numerators out of 48 and counts of discordant pairs in both directions. An unparseable response uses one turn and leaves the state unchanged. An episode can still succeed by recovering within its turn budget. Report time/turn limits, invalid responses, infrastructure errors and missing records separately. Missing or errored episodes supply no confirmed success to the scheduled-system denominator. Report complete-pair coverage alongside that measure.

The three families receive equal weight. Each family contains four equally weighted seeds with both commit states, menu orders and instructions retained together. For descriptive sensitivity to the fixture mix, use a stratified cluster bootstrap: within each family draw four seeds with replacement, keep all matched cells in each draw, repeat 10,000 times with seed 20261124, and report the percentile interval for the paired difference. This conditional interval describes variation over the four fixture seeds per family. These seeds, families and model checkpoints are a convenience sample, with no random sampling of production systems.

## Secondary diagnostics

Report results by family and prior commit state, sensitivity to menu order, first-action inspection, duplicate effects, omitted effects, collateral changes and invalid output where identifiable. Compare these with the reference policies. Separate decision-level counts from episode-level counts. Treat family, menu-order and trace analyses as descriptive. Annotate selected trajectories with their selection rule. A claim about learning or persistence across sessions would require a separate design.

## Completion and deviations

Collect the full fixed grid once per pinned checkpoint. Resume an interrupted collection only for cells without a completed record and disclose infrastructure interruptions. Keep original responses, including failures. A genuine harness defect requires a documented revision and clearly identified rerun; changing a control after seeing results is an exploratory follow-up. The report must identify actual deviations. The repository timestamp records the design freeze; no independent preregistration registry or journal submission is implied.
