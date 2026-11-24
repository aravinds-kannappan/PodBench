# How the recovery instruction changed the next action

Exploratory comparison across the frozen 192-episode recovery grid.

| Checkpoint | Instruction | First inspection | Mean legal P(inspect) | Post-inspection swaps | Mean swap distance |
| --- | --- | ---: | ---: | ---: | ---: |
| Qwen2.5-0.5B | generic recovery request | 0/48 | 1.0% | 0 | — |
| Qwen2.5-0.5B | inspect-first instruction | 10/48 | 29.9% | 16 | 0.172 |
| SmolLM2-360M | generic recovery request | 16/48 | 19.6% | 64 | 0.010 |
| SmolLM2-360M | inspect-first instruction | 12/48 | 15.6% | 48 | 0.013 |

Qwen first inspected more often under the explicit instruction, while SmolLM first inspected less often. All 192 episodes ended without a verified submission in the exact target state. Observing the first move alone would miss that outcome. [Computed counts and probability contrasts](scores-summary.json) · [Recovery outcomes](../../../docs/recovery-results.json)

## Which response gained probability on the first turn?

The entries below subtract the generic instruction from the inspect-first instruction, in percentage points, for each exact menu response. Each mean uses 16 first decisions per model, family and instruction. Probabilities are normalized over canonical tokenizations followed by end-of-turn. [All decision-level token probabilities](scores-decisions.jsonl)

| Family | Action | Qwen change (pp) | SmolLM change (pp) |
| --- | --- | ---: | ---: |
| inventory | `close_receipt` | -1.2 | +4.5 |
| inventory | `inspect` | +43.1 | -4.0 |
| inventory | `receive_stock` | -0.4 | -2.5 |
| inventory | `submit` | -41.5 | +2.0 |
| refund | `inspect` | +10.8 | -4.7 |
| refund | `mark_refunded` | +14.6 | +5.9 |
| refund | `record_refund` | -29.6 | +0.2 |
| refund | `submit` | +4.3 | -1.4 |
| transfer | `archive_customer` | -21.4 | +0.9 |
| transfer | `inspect` | +33.0 | -3.4 |
| transfer | `move_orders` | +0.3 | -0.4 |
| transfer | `remove_customer` | -0.6 | +12.8 |
| transfer | `submit` | -11.3 | -10.0 |

Each swap changes only the latest tool result. Its total variation distance measures movement over complete legal action responses. Repeated decisions from the same episode contribute multiple rows. The four condition accounts give the number that changed the highest-scoring action and show the largest measured shift. [Counterfactual scores](scores-swaps.jsonl)

- [Qwen2.5-0.5B with the generic recovery request](explain-qwen2.5-0.5b-baseline.md)
- [Qwen2.5-0.5B with the inspect-first instruction](explain-qwen2.5-0.5b-inspect_first.md)
- [SmolLM2-360M with the generic recovery request](explain-smollm2-360m-baseline.md)
- [SmolLM2-360M with the inspect-first instruction](explain-smollm2-360m-inspect_first.md)

[All numerical comparisons](scores-summary.json) · [Scoring and reproduction](scores-method.md)
