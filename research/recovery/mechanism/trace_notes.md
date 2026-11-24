# Trajectory extraction

**Exploratory (not preregistered)**

Run `python research/recovery/mechanism/trace_extract.py` from the repository root. To regenerate in a temporary directory, pass `--output DIRECTORY`. Run `python -m unittest discover -s research/recovery/mechanism -p 'test_trace.py'` to verify the archive and outputs. The extractor parses each archived reply with the frozen exact-name rule, executes it against a fresh frozen SQLite environment, replaces each observation and verdict with the replay, then asserts equality to the entire archived JSON line in its original serialization. Invalid replies consume a turn without executing SQL.

Join `trace_decisions.csv` and `trace_episodes.csv` by episode `id`. Each decision also has a one-based `turn`. `trace_schema.json` describes their decoded types. Empty cells represent unavailable values. Booleans are lowercase JSON literals. Menus, observations, differences and viable actions are JSON inside CSV cells. A database difference lists full missing and extra row tuples by table, including repeated rows. Both tables are compared as multisets of all columns; surrogate SQLite rowids are excluded. The target comes from applying the frozen writes to a fresh, rolled-back fixture and passing the verifier.

## Two reachability endpoints

At every prefix, including after the final decision, the extractor searches the full action menu to the remaining horizon. It applies actual SQLite statements inside savepoints and restores the submitted flag after each branch. The memoization key includes all table contents, fixture identity, whether the episode closed and the remaining budget. Inspection and a failed SQL action both consume a move. The state-only search can stop once every endpoint is true. The submitted search also requires an executed submit. An incorrect submit ends all possible continuations. A blank first-unreachable marker means the endpoint could still be reached when the episode ended. The difference matters for jobs that reached the exact state on time but never submitted.

`viable_next` maps every selectable action admitting a verified submission to the minimum number of moves, including that action. `force_oracle` chooses a shortest verified route with canonical action insertion order breaking ties regardless of the displayed order. This controller can read the actual state. `evidence_proposal` is inspect while both initial worlds remain consistent with the contact history. To track that ambiguity, the extractor replays the same actions in the other initial world and compares only the result and error shown to the worker. Once the alternative world is ruled out, the proposal uses the shortest route in the identified state. `force_evidence` contains the proposal only when a verified submission remains possible after that move in the actual state. Absence of a feasible forcing action is a structural result. The force experiments report the number of eligible interventions separately. The target state, alternative world and viability checks are evaluator information.

## Reply and loop measures

`position_1based` indexes a valid action in that episode's displayed menu. Exact action or reply repetition compares adjacent turns. `action_loop_period` is the shortest repeated block length at the current suffix, with at least two adjacent, identical blocks of valid actions. `invalid_loop_period` uses full rejected reply text after stripping outer whitespace and breaks on any valid action. Zero means no detected suffix loop. Ending twice with inspect counts as a loop even when reading again could have been warranted under some other environment. Rejected text is assigned to empty, valid name with extra text, unknown action name or free text. The lexical claim detector recognizes explicit first-person statements of inspection, checking or verification and statements of completed inspection. A menu command named inspect is a request. The separate fields track previous executed inspection and actual inspection on this turn. The detector cannot determine a model's beliefs or recognize every paraphrase.

## Exclusive failure precedence

Each archived unsuccessful episode receives the first applicable label below. The order makes co-occurring failures visible in the underlying per-decision data while counting each episode once.

1. **Exact state without submit.** The final database meets every endpoint; submit was absent.
2. **Wrong-row write.** The final protected-row check failed. The frozen menus bind writes to named rows and afford little opportunity for this error.
3. **Duplicate write.** The final state contains an excessive refund, inventory increment or archive copy.
4. **No valid decision.** Every reply failed the parser.
5. **Premature submit.** The episode submitted an inexact state after the preceding categories were excluded. This covers any turn of submission, including the last turn.
6. **Invalid-action loop.** The run ended in a repeated suffix of rejected replies after at least one valid action.
7. **Repeated-action loop.** The run ended in a repeated suffix of valid actions.
8. **Incomplete reconciliation.** Remaining failures at timeout, including missing initial effects or unfinished downstream work.

The taxonomy's zero counts depend on the chosen precedence. An all-invalid loop, for example, is assigned to no valid decision. The frozen diagnostic counts allow overlap and answer a different question.
