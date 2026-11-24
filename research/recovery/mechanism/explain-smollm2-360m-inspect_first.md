# SmolLM2-360M with the inspect-first instruction

Exploratory analysis of archived decisions.

The model selected `inspect` first in **12/48** episodes and `submit` first in **12/48**. Across the same work orders its mean probability of the complete inspect response, normalized over menu responses, was 15.6%, less than the 19.6% under the other instruction. The run ended in exact state with explicit submission 0/48 times. [Computed counts and probability contrasts](scores-summary.json) · [SQLite verification](../../../docs/recovery-results.json)

## The first decision

| Menu | Interrupted write | Episodes | Recorded responses |
| --- | --- | ---: | --- |
| canonical | absent | 12 | inspect × 6, mark_refunded × 4, receive_stock × 1, invalid × 1 |
| canonical | committed | 12 | inspect × 6, mark_refunded × 4, invalid × 1, receive_stock × 1 |
| reversed | absent | 12 | submit × 6, remove_customer × 4, invalid × 2 |
| reversed | committed | 12 | submit × 6, remove_customer × 4, invalid × 2 |

The canonical menu accounted for 12 first inspections. The reversed menu produced 0 first inspections, 12 submissions, 8 attempts to remove a customer and 4 invalid first replies. [Computed counts and probability contrasts](scores-summary.json)

The first prompt is identical across the paired hidden states. Each order has twelve first decisions per state. The rows show the replies before the model could inspect the database. [Computed counts and probability contrasts](scores-summary.json)

## Later decisions

| Turn | Decisions | Recorded responses | Leading first-token candidate¹ |
| ---: | ---: | --- | --- |
| 1 | 48 | inspect × 12, submit × 12, remove_customer × 8, mark_refunded × 8, invalid × 6, receive_stock × 2 | `submit` (11.9%) |
| 2 | 36 | inspect × 12, remove_customer × 8, mark_refunded × 8, invalid × 6, receive_stock × 2 | `ins` (22.7%) |
| 3 | 36 | inspect × 12, remove_customer × 8, mark_refunded × 8, invalid × 6, receive_stock × 2 | `ins` (33.0%) |
| 4 | 36 | inspect × 12, remove_customer × 8, mark_refunded × 8, invalid × 6, receive_stock × 2 | `ins` (33.3%) |
| 5 | 36 | inspect × 12, remove_customer × 8, mark_refunded × 8, invalid × 6, receive_stock × 2 | `ins` (33.2%) |

¹ Ranked by summed probability across the ten saved first-token candidates per decision. A token outside the top ten contributes zero, so the percentage is a lower bound on its mean vocabulary probability. Each later turn includes only episodes still running. [All decision-level token probabilities](scores-decisions.jsonl)

## After inspection

We replaced the latest inspection result with the result after replaying the same moves in the opposite commit state. All earlier messages stayed fixed. There were 48 such next decisions and 48 feedback replacements that differed from the original in these comparisons. The highest-scoring legal action changed in 0/48 comparisons. Mean total variation distance was 0.013 on a scale from zero (identical menu distribution) to one (disjoint). [Counterfactual scores](scores-swaps.jsonl)

In the archived continuations, the initially absent world supplied 24 next decisions (inspect × 24) and the initially committed world supplied 24 next decisions (inspect × 24). Across changed readings the mean probability of reapplying the uncertain write differed by +0.75 percentage points (initially absent minus committed, orienting every swap the same way). [Computed counts and probability contrasts](scores-summary.json)

The largest observed shift was 0.066 in `smollm2-360m.transfer.53.rolled_back.inspect_first.canonical`, turn 2. The original top action was `inspect` and the swapped top action was `inspect`. [Computed counts and probability contrasts](scores-summary.json)

[Compare all four conditions](explain-comparison.md) · [Scoring and reproduction](scores-method.md)
