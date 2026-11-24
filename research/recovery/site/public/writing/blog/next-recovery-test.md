---
title: "The next recovery test I would run"
date: 2026-11-24
status: draft
tags: [study-design, idempotency, replication]
reading_minutes: 3
summary: "A held-out workflow, an applied-check arm and an explicit minimum worthwhile improvement."
---
# The next recovery test I would run

The recovery study asked a worker to finish an interrupted job once and signal that it was done. Across [12](https://github.com/aravinds-kannappan/PodBench/blob/recovery-v1.0.0/research/recovery/episodes.jsonl) distinct work orders, neither small checkpoint met that contract under either instruction. I would use the result to design a more discriminating comparison. Repeating the same episodes until a different answer appears would mix changes in sampling with changes in the task or policy. I want a test whose outcome could alter a decision about how to build the service.

First I would ask another team to write some of the fixtures. An outside author may think of an order reversal, a delayed receipt or a legitimate partial refund that our templates never represent. The task specification should spell out what counts as an exact recovery before anyone runs a model on the evaluation cases. A separate development set can support prompt design and debugging. Holding back complete families would make it harder to tune to a particular action vocabulary and mistake that familiarity for general recovery ability.

I would compare the original reconciliation interface with a read-only operation that answers a specific question: did this logical request already take effect? That removes some interpretation work while leaving the model responsible for choosing and finishing the remaining operations. A service-side idempotency key changes a different component. If two attempted writes share a logical request identifier, the service can suppress an unwanted duplicate. The model can still omit work or submit too soon. Putting the two alternatives in separate arms lets the experiment distinguish clearer evidence from stronger execution guarantees. [Idempotent API design](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)

I would include a stronger checkpoint and repeat some development episodes under a specified sampling policy. A single greedy response describes a particular execution. It does not estimate the probability that a stochastic service will recover on its next attempt. Repetitions might increase cost substantially, so I would count a work order as the unit of sampling and keep repeated seeds and paired conditions together in the analysis. A token, turn or copied menu is not a fresh independent incident.

Before choosing a sample size, I would write down the smallest improvement that would justify changing the service. A modest reduction in duplicate payments might be worthwhile even if the overall completion rate barely moves. The pilot needs an estimate of how often paired policies disagree as well as how often either policy succeeds. The current all-failure primary outcome provides poor information for that calculation. The design and power assumptions should be public before the held-out evaluation begins.

I would also preserve the uncomfortable outcomes. A malformed tool call, a timed-out episode and a correct database with a missing completion signal present different problems to an operator. Dropping them all from the denominator would make the integration look easier than it is. Reporting them separately allows another team to adapt the metric to its own completion contract while retaining a shared audit trail.

Someone can already start a replication by writing a new policy against the existing environment and checking its responses against the released journal format. The next step is to make a prediction about the new service arm that can fail, name the endpoint and then run it on untouched cases. If a reminder helps only when the database exposes a clear applied flag, that result would have a direct implication for interface design. [Policy adapter and fixture guide](https://github.com/aravinds-kannappan/PodBench/blob/recovery-v1.0.0/research/recovery/README.md)
