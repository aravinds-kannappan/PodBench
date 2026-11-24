# Independent expert review

**Exploratory (not preregistered)**

Open [the annotation workspace](../../site/public/review/index.html) on the static site, enter a pseudonym, score cases, then export your JSON. When testing locally, serve the site over HTTP from the repository root:

```sh
python -m http.server --directory research/recovery/site/public 8000
```

Visit `http://localhost:8000/review/index.html`. Only static files are requested. The session stores ratings in the annotator's own browser and uses a local download. There is no submission endpoint. Closing a private window or clearing local storage can lose work. The study team must collect the exported JSONs from people separately with permission. Free-text notes are excluded from the public comparison report.

## Sampling and masking

The kit draws a fixed sample from the frozen archive. Each model, instruction, workflow and commit-state combination has two or three cases. A parity rule across sorted factor levels assigns the third slot to half the strata, balancing the factor margins. The generator covers every observed automated failure category once, rarest first. Within a stratum, filling favors the least represented category, with seeded tie breaks. The sample is designed for error diversity. Its label frequencies cannot estimate population rates. Some five-factor combinations have no available episode, and some available combinations are unsampled. The manifest lists population and sample counts for every populated combination.

A fixed shuffle assigns case aliases in presentation order. The annotator sees the original user handoff, menu order, raw replies, real SQLite responses, database differences and terminal status. Hidden commit state, model, instruction, seed, automated label and archive ID do not appear as metadata on the form. Task details can reveal the fixture and an observation can reveal the earlier commit outcome. The public source contains the answer key for post-review comparison. Researchers doing a blind review should avoid the key and archives until they have locked their ratings. The kit masks experimental labels for convenience and provides no guarantees against deliberate reidentification.

`generate.py` rebuilds the static JSON, downloadable CSV, sample key and manifest. `generate.py --check` verifies their exact bytes. Every kit hash binds its evidence and rubric. Data differences list extra and missing row tuples by table. The case includes the column order and multiplicity is preserved. For a rejected reply there is no tool observation. On the website, an original em dash inside a reply is represented by its Unicode escape. The JSON preserves the original string. The CSV has one case per row with JSON columns for the menu, turns, schema and row differences.

## Scoring and aggregation

The rubric in `generate.py` asks about evidence of recognizing uncertainty, evidence gathering, the first substantive action after an inspection, severity, hypothetical production safety and an exclusive failure label. Reviewers can select indeterminate or insufficient evidence where available. These are judgments about observable actions. The study contains no direct measurement of understanding or real production impact.

After obtaining real independent exports, analyze them locally:

```sh
python research/recovery/mechanism/review/agreement.py --output /tmp/podbench-review-report.json path/to/reader-a.json path/to/reader-b.json
```

Validate and review the output before placing it at `research/recovery/site/public/review/agreement.json`. A checked-in status of **awaiting annotations** means no real ratings have been published. To generate that status for an empty collection, run the command with no input exports. An invalid kit hash, repeated annotator ID, unknown case or unsupported response prevents scoring. Supply the latest export per unique annotator. Partial response sets are accepted. The report replaces the provided pseudonyms with reader aliases and omits free-text notes.

For each rubric item, pairwise Cohen kappa uses shared, nonmissing answers for each pair. Unweighted Fleiss kappa uses the cases answered by the full active panel on that question. The fixed panel includes everyone contributing at least one rating anywhere; one rater skipping a whole item leaves no complete panel on that item. Every statistic reports its denominator. Fewer than two comparable cases, fewer than two panel raters or a chance-agreement denominator of zero gives an undefined estimate with a reason. Explicit “indeterminate” and “insufficient evidence” are valid categories; blank responses are missing. Human versus automated comparisons report each reader's Cohen kappa, a pooled count matrix, and disagreements identified by masked case and reader alias. In the matrix a case rated by two people contributes two entries. Kappa is sensitive to prevalence, and all results describe this selected sample.

```sh
python -m unittest discover -s research/recovery/mechanism/review -p 'test_*.py'
```
