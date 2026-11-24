# SmolLM2-360M with the generic recovery request

Exploratory analysis of archived decisions.

The model selected `inspect` first in **16/48** episodes and `submit` first in **22/48**. Across the same work orders its mean probability of the complete inspect response, normalized over menu responses, was 19.6%, more than the 15.6% under the other instruction. The run ended in exact state with explicit submission 0/48 times. [Computed counts and probability contrasts](scores-summary.json) · [SQLite verification](../../../docs/recovery-results.json)

## The first decision

| Menu | Interrupted write | Episodes | Recorded responses |
| --- | --- | ---: | --- |
| canonical | absent | 12 | inspect × 8, mark_refunded × 4 |
| canonical | committed | 12 | inspect × 8, mark_refunded × 4 |
| reversed | absent | 12 | submit × 11, invalid × 1 |
| reversed | committed | 12 | submit × 11, invalid × 1 |

The canonical menu produced 16 first inspections. With the reversed menu, the checkpoint first inspected 0 times and submitted immediately 22 times. [Computed counts and probability contrasts](scores-summary.json)

The first prompt is identical across the paired hidden states. Each order has twelve first decisions per state. The rows show the replies before the model could inspect the database. [Computed counts and probability contrasts](scores-summary.json)

## Later decisions

| Turn | Decisions | Recorded responses | Leading first-token candidate¹ |
| ---: | ---: | --- | --- |
| 1 | 48 | submit × 22, inspect × 16, mark_refunded × 8, invalid × 2 | `submit` (12.6%) |
| 2 | 26 | inspect × 16, mark_refunded × 8, invalid × 2 | `ins` (35.6%) |
| 3 | 26 | inspect × 16, mark_refunded × 8, invalid × 2 | `ins` (59.1%) |
| 4 | 26 | inspect × 16, mark_refunded × 8, invalid × 2 | `ins` (61.0%) |
| 5 | 26 | inspect × 16, mark_refunded × 8, invalid × 2 | `ins` (61.2%) |

¹ Ranked by summed probability across the ten saved first-token candidates per decision. A token outside the top ten contributes zero, so the percentage is a lower bound on its mean vocabulary probability. Each later turn includes only episodes still running. [All decision-level token probabilities](scores-decisions.jsonl)

## After inspection

We replaced the latest inspection result with the result after replaying the same moves in the opposite commit state. All earlier messages stayed fixed. There were 64 such next decisions and 64 feedback replacements that differed from the original in these comparisons. The highest-scoring legal action changed in 0/64 comparisons. Mean total variation distance was 0.010 on a scale from zero (identical menu distribution) to one (disjoint). [Counterfactual scores](scores-swaps.jsonl)

In the archived continuations, the initially absent world supplied 32 next decisions (inspect × 32) and the initially committed world supplied 32 next decisions (inspect × 32). Across changed readings the mean probability of reapplying the uncertain write differed by +0.66 percentage points (initially absent minus committed, orienting every swap the same way). [Computed counts and probability contrasts](scores-summary.json)

The largest observed shift was 0.089 in `smollm2-360m.inventory.53.committed.baseline.canonical`, turn 2. The original top action was `inspect` and the swapped top action was `inspect`. [Computed counts and probability contrasts](scores-summary.json)

[Compare all four conditions](explain-comparison.md) · [Scoring and reproduction](scores-method.md)
