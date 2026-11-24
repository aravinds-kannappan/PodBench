# Qwen2.5-0.5B with the inspect-first instruction

Exploratory analysis of archived decisions.

The model selected `inspect` first in **10/48** episodes and `submit` first in **22/48**. Across the same work orders its mean probability of the complete inspect response, normalized over menu responses, was 29.9%, more than the 1.0% under the other instruction. The run ended in exact state with explicit submission 0/48 times. [Computed counts and probability contrasts](scores-summary.json) · [SQLite verification](../../../docs/recovery-results.json)

## The first decision

| Menu | Interrupted write | Episodes | Recorded responses |
| --- | --- | ---: | --- |
| canonical | absent | 12 | inspect × 4, invalid × 4, archive_customer × 4 |
| canonical | committed | 12 | archive_customer × 4, inspect × 4, invalid × 4 |
| reversed | absent | 12 | submit × 11, inspect × 1 |
| reversed | committed | 12 | submit × 11, inspect × 1 |

The canonical menu produced 8 first inspections. With the reversed menu, the checkpoint first inspected 2 times and submitted immediately 22 times. [Computed counts and probability contrasts](scores-summary.json)

The first prompt is identical across the paired hidden states. Each order has twelve first decisions per state. The rows show the replies before the model could inspect the database. [Computed counts and probability contrasts](scores-summary.json)

## Later decisions

| Turn | Decisions | Recorded responses | Leading first-token candidate¹ |
| ---: | ---: | --- | --- |
| 1 | 48 | submit × 22, inspect × 10, invalid × 8, archive_customer × 8 | `submit` (32.7%) |
| 2 | 26 | receive_stock × 8, invalid × 8, archive_customer × 8, inspect × 2 | `archive` (28.8%) |
| 3 | 26 | submit × 8, invalid × 8, archive_customer × 8, inspect × 2 | `submit` (43.3%) |
| 4 | 18 | invalid × 8, archive_customer × 8, inspect × 2 | `archive` (35.8%) |
| 5 | 18 | invalid × 8, archive_customer × 8, submit × 2 | `archive` (38.2%) |

¹ Ranked by summed probability across the ten saved first-token candidates per decision. A token outside the top ten contributes zero, so the percentage is a lower bound on its mean vocabulary probability. Each later turn includes only episodes still running. [All decision-level token probabilities](scores-decisions.jsonl)

## After inspection

We replaced the latest inspection result with the result after replaying the same moves in the opposite commit state. All earlier messages stayed fixed. There were 16 such next decisions and 16 feedback replacements that differed from the original in these comparisons. The highest-scoring legal action changed in 2/16 comparisons. Mean total variation distance was 0.172 on a scale from zero (identical menu distribution) to one (disjoint). [Counterfactual scores](scores-swaps.jsonl)

In the archived continuations, the initially absent world supplied 8 next decisions (receive_stock × 4, inspect × 3, submit × 1) and the initially committed world supplied 8 next decisions (receive_stock × 4, inspect × 3, submit × 1). Across changed readings the mean probability of reapplying the uncertain write differed by +2.25 percentage points (initially absent minus committed, orienting every swap the same way). [Computed counts and probability contrasts](scores-summary.json)

The largest observed shift was 0.514 in `qwen2.5-0.5b.transfer.37.rolled_back.inspect_first.reversed`, turn 5. The original top action was `submit` and the swapped top action was `inspect`. [Computed counts and probability contrasts](scores-summary.json)

[Compare all four conditions](explain-comparison.md) · [Scoring and reproduction](scores-method.md)
