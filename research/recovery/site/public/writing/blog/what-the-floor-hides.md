---
title: "What a zero recovery score hides"
date: 2026-11-24
status: draft
tags: [metrics, recovery, evaluation]
reading_minutes: 3
summary: "Submitting a broken database and leaving a correct one unsubmitted produce the same primary score."
---
# What a zero recovery score hides

If I only looked at the last column of the recovery table, I could get through the results very quickly. The numerator is [0](https://github.com/aravinds-kannappan/PodBench/blob/recovery-v1.0.0/docs/recovery-results.json). Every checkpoint and instruction cell has the same number of successful jobs. A chart of that measure contains very little ink. The danger is deciding that the underlying workers did the same thing, or that changing the instruction had no effect on any decision that mattered.

The endpoint has two parts. The database must satisfy every requirement, and the model must call submit. These correspond to two events in an operational system. First, the work itself happens. Then someone responsible for the next stage receives a signal that the job is complete. It is possible for either event to occur in isolation. The benchmark keeps the records needed to see both.

Consider the paths to failure. The workers submitted [94](https://github.com/aravinds-kannappan/PodBench/blob/recovery-v1.0.0/docs/recovery-results.json) incorrect databases. If the host trusted the submit signal, those jobs would leave its queue even though something was wrong with the state. Another [8](https://github.com/aravinds-kannappan/PodBench/blob/recovery-v1.0.0/docs/recovery-results.json) episodes reached the expected database but ended without a submission. A worker waiting on that signal might retry the job and create a new problem. The effect on a deployed system would depend on how that system handles a missing signal, so the count identifies an exposure and does not estimate a production incident rate.

The exact-state cases looked promising at first glance. They all concerned a refund whose ledger entry was already present. SmolLM2 kept applying the status update. Once the order said “refunded,” repeating the status change could leave the database correct. The model still used up the rest of its turns. If I interpreted that final snapshot as proof that the model had read the ledger and understood the interruption, I would be giving it credit for a decision it never had to make. [Scored episode table](https://github.com/aravinds-kannappan/PodBench/blob/recovery-v1.0.0/docs/recovery-episodes.csv)

There is another trap in the uncertainty estimate. The study resampled fixture seeds together with the paired outcomes that belonged to them. In the primary comparison all those outcomes are failures. Every possible resample therefore yields the same estimated difference. A narrow interval produced by that procedure cannot establish that the two instructions work equally well on new tasks. The data had no resolution for that question at this endpoint. [Paired analysis](https://github.com/aravinds-kannappan/PodBench/blob/recovery-v1.0.0/research/recovery/analyze.py)

A useful follow-up would give the measurement room to move. We could pilot a larger checkpoint on different fixtures and check how often an ordinary job finishes. We could include a less ambiguous action adapter. We could give the service a way to recognize a repeated request. Each choice changes the question, so I would decide on the intervention, unit of analysis and minimal worthwhile improvement before looking at outcomes from the evaluation cases.

I still want the unforgiving primary score. A system that promises a correct, acknowledged recovery should have to deliver both parts. What I want alongside it is a ledger of the partial outcomes. When the score sits on the floor, that ledger is how another engineer can tell whether to examine the recovery logic, the stopping rule, the tool interface or the service itself.


**Exploratory (not preregistered)**

In an exploratory menu sweep Qwen recovered the committed refund on [2](https://github.com/aravinds-kannappan/PodBench/blob/recovery-mechanism-v1.0.0/research/recovery/mechanism/blackbox/results.json)/[24](https://github.com/aravinds-kannappan/PodBench/blob/recovery-mechanism-v1.0.0/research/recovery/mechanism/blackbox/results.json) presentations of the same work order. Within that sweep the checkpoint, database and action names stayed fixed. Only the presentation order varied. I would now ask which part of the interface made the right sequence easier to produce. Counting the extra layouts as fresh refund cases would obscure that question.
