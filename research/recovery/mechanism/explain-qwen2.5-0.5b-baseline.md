# Qwen2.5-0.5B with the generic recovery request

Exploratory analysis of archived decisions.

The model selected `inspect` first in **0/48** episodes and `submit` first in **24/48**. Across the same work orders its mean probability of the complete inspect response, normalized over menu responses, was 1.0%, less than the 29.9% under the other instruction. The run ended in exact state with explicit submission 0/48 times. [Computed counts and probability contrasts](scores-summary.json) · [SQLite verification](../../../docs/recovery-results.json)

## The first decision

| Menu | Interrupted write | Episodes | Recorded responses |
| --- | --- | ---: | --- |
| canonical | absent | 12 | archive_customer × 4, submit × 4, invalid × 3, record_refund × 1 |
| canonical | committed | 12 | submit × 4, archive_customer × 4, invalid × 3, record_refund × 1 |
| reversed | absent | 12 | submit × 8, invalid × 4 |
| reversed | committed | 12 | submit × 8, invalid × 4 |

On the reversed menu the checkpoint began by submitting 16 times and gave an invalid first reply 8 times. [Computed counts and probability contrasts](scores-summary.json)

The first prompt is identical across the paired hidden states. Each order has twelve first decisions per state. The rows show the replies before the model could inspect the database. [Computed counts and probability contrasts](scores-summary.json)

## Later decisions

| Turn | Decisions | Recorded responses | Leading first-token candidate¹ |
| ---: | ---: | --- | --- |
| 1 | 48 | submit × 24, invalid × 14, archive_customer × 8, record_refund × 2 | `submit` (47.1%) |
| 2 | 24 | archive_customer × 8, invalid × 6, remove_customer × 6, submit × 4 | `archive` (40.4%) |
| 3 | 20 | archive_customer × 8, invalid × 6, remove_customer × 6 | `archive` (33.3%) |
| 4 | 20 | archive_customer × 8, invalid × 6, remove_customer × 6 | `archive` (39.8%) |
| 5 | 20 | archive_customer × 8, invalid × 6, remove_customer × 6 | `archive` (39.9%) |

¹ Ranked by summed probability across the ten saved first-token candidates per decision. A token outside the top ten contributes zero, so the percentage is a lower bound on its mean vocabulary probability. Each later turn includes only episodes still running. [All decision-level token probabilities](scores-decisions.jsonl)

## After inspection

There were no archived next decisions immediately following inspection in this condition. The corpus therefore supplies no within-prefix observation swap for this condition. [Computed counts and probability contrasts](scores-summary.json)

[Compare all four conditions](explain-comparison.md) · [Scoring and reproduction](scores-method.md)
