# podbench

Deterministic, resettable task environments for LLM agents, with a programmatic
verifier, run concurrently on Kubernetes with per-run token metering, rate-limit
backoff, and prompt caching. The dashboard puts pod health and model behavior on
one pane.

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-43853d.svg)](package.json)
[![model](https://img.shields.io/badge/policy-claude--opus--4--8-5ad1b3.svg)](lib/agent/runner.ts)

---

## Why this exists

Most agent evaluation is run as a notebook against a handful of tasks, scored by
eyeball, on whatever laptop happened to be free. That is fine until you want to
answer the questions that actually matter in production:

1. Is the agent getting better or worse, run over run, on the same task?
2. What is one passing run costing me, in tokens and dollars, and where does the
   cost go?
3. When I run hundreds of agents at once, does the system fall over, and is it
   the model misbehaving or the infrastructure?

Those three questions pull in different directions. Question 1 needs an
environment that is **deterministic and resettable** so the only thing changing
between runs is the policy. Question 2 needs **token accounting wired into the
run itself**, not bolted on afterward. Question 3 needs the agent loop to run as
a **horizontally scalable worker** with a real queue, real backpressure, and
real observability, so you can tell a `CrashLoopBackOff` apart from a model that
has started looping.

podbench is the smallest thing that holds all three at once. It is one agent loop
that runs in two places, the dashboard and the worker, against the same
deterministic environment, scored by the same verifier, metered the same way. The
result is a single view where a pod going `OOMKilled` sits next to the run whose
cache hit rate collapsed, and you can see whether they are related.

## What it is

- An **environment contract**: build a starting world, hand the agent a small
  tool surface, and grade the world (or the answer) it leaves behind. The
  reference environment is a SQL operations console: a seeded order-management
  database the agent reads and mutates through a single `run_sql` tool.
- An **agent runner** that drives the policy through the environment with token
  metering, rate-limit backoff, and prompt caching built in.
- A **fleet layer**: a queue, a worker that wraps the runner, a container image,
  and Kubernetes manifests with queue-driven autoscaling.
- A **Next.js dashboard**, deployable on Vercel, that renders model behavior and
  pod health together, and can execute a live run on demand.

## The environment contract

An environment is three functions. The reference SQL environment lives in
[`lib/env/`](lib/env).

```
seed()    -> world      build a fresh, isolated starting state
tools     -> actions    the surface the agent acts through (run_sql, submit)
verify(world, answer) -> { reward in [0,1], passed, detail }
```

Two properties make the numbers mean something:

**Deterministic.** The world is seeded from fixed fixtures
([`lib/env/seed.ts`](lib/env/seed.ts)) and all date math runs against a pinned
clock (`PODBENCH_ENV_NOW`, default `2026-06-15`), so "orders older than 30 days"
resolves to the same set forever. The verifier never calls the model; it computes
ground truth by seeding its own clean copy of the same fixtures and comparing.
The policy is the only stochastic element in the loop.

**Resettable.** `seedDatabase()` returns a brand new in-memory database on every
call. There is no shared mutable state between runs, no teardown step that can
leak, and no external service to reset. Reset is "make a new one," which is also
why a thousand concurrent runs do not contend on a single fixture.

The engine is [alasql](https://github.com/agershun/alasql), a pure-JavaScript SQL
database. That choice is deliberate (see Tradeoffs): no native build, no WASM
asset to host, no container to provision, so an environment instance is a few
milliseconds and a few kilobytes, and it runs unchanged in a Vercel serverless
function, a Kubernetes worker, and a unit test.

### Reward shaping

Question tasks (for example "which email has the highest lifetime spend") are
graded by exact match against a value computed from a freshly seeded database.
State-mutation tasks (for example "issue a full refund for order 1007") are
graded by weighted checks on the database the agent left behind, so partial
credit is visible: setting the order status but forgetting the refund row earns
0.4, not 0. The continuous reward is what makes the reward-distribution histogram
on the dashboard informative rather than a single pass/fail bar.

The reference set ships six environments across three difficulties, each probing
a planted situation in the fixtures (a duplicate customer, an oversell that drove
stock negative, stale orders, an unrefunded paid order). See the Environments
section of the dashboard or [`lib/env/tasks.ts`](lib/env/tasks.ts).

## Architecture

```
                         ANTHROPIC_API_KEY
                                |
        +-----------------------+------------------------+
        |                                                |
  +-----v------+   Vercel (serverless)            +------v-------+  Kubernetes
  |  Dashboard |                                  |   Worker     |  (N replicas)
  |  Next.js   |   /api/run  -------------------> | BLPOP queue  |
  |  app router|                                  | run episode  |
  +-----+------+                                  +------+-------+
        |  reads                                         | reports (structured logs)
        v                                                v
  data/runs.json  <----- backfill (real runs) -----  lib/agent/runner.ts
  data/fleet.json                                          |
        ^                                                  | run_sql / submit
        |  pod-health + behavior                           v
   browser                                          lib/env  (seed + verify)
                                                          ^
   load -> scripts/enqueue.mjs -> Redis list -> KEDA scales worker replicas
```

The load-bearing idea is that [`lib/agent/runner.ts`](lib/agent/runner.ts) is
imported by both the dashboard's `/api/run` route and the Kubernetes worker. A
run triggered from the browser and a run drained from the queue are the same code
path, the same tools, the same metering, the same verifier. There is no "eval
harness" that drifts from "production."

### Components

| Path | Role |
| --- | --- |
| `lib/env/` | Deterministic environment: fixtures, schema, operator playbook, tasks, verifiers. |
| `lib/agent/runner.ts` | The agent loop: tool dispatch, token metering, backoff, caching, verification. |
| `lib/agent/pricing.ts` | Per-model price table and the cost and cache-hit math. |
| `lib/data/store.ts` | Reads the recorded window, merges in live runs, computes aggregate stats. |
| `app/` | Next.js dashboard and JSON API (`/api/runs`, `/api/fleet`, `/api/stats`, `/api/run`). |
| `infra/worker/` | The horizontally scaled queue consumer that wraps the runner. |
| `infra/k8s/` | Namespace, Redis broker, worker Deployment, KEDA scaler, HPA fallback. |
| `scripts/` | Dataset generation, real-run backfill, and a queue load generator. |

## The agent loop

The policy gets two tools and nothing else:

- `run_sql(query)` executes one statement against the run's private database and
  returns rows or the affected-row count. Errors come back as tool results with
  `is_error: true` so the model can recover rather than crash the run.
- `submit(answer?)` ends the episode. Question tasks pass an answer; state tasks
  submit with none.

The loop appends each assistant turn and tool result to the message list, runs up
to a step ceiling, and on `submit` hands the final database (and any answer) to
the verifier. Because the only data access is `run_sql`, the loop is also a clean
sandbox: there is no path from the model to the host, the network, or another
run's state.

### Token metering

Usage is summed off `response.usage` on every turn into four buckets that bill
differently:

| Field | Meaning | Price |
| --- | --- | --- |
| `input_tokens` | Uncached input | 1.0x input rate |
| `cache_creation_input_tokens` | Tokens written to cache | 1.25x input rate (5 minute TTL) |
| `cache_read_input_tokens` | Tokens served from cache | 0.1x input rate |
| `output_tokens` | Generated output | output rate |

Cost is computed in [`lib/agent/pricing.ts`](lib/agent/pricing.ts) against a
per-model table (Claude Opus 4.8 at 5 dollars in / 25 dollars out per million is
the default policy). The dashboard never estimates cost from a token count; every
run carries its own metered cost, and the aggregates sum those.

### Prompt caching

The request is laid out so the stable prefix caches and the volatile part does
not. Render order is tools, then system, then messages, so a single
`cache_control: { type: "ephemeral" }` breakpoint on the last system block caches
the tool definitions and the entire system prompt together. The per-task prompt
goes in the first user message, after the breakpoint, where it cannot invalidate
the prefix.

There is a real constraint here worth calling out: on the Opus tier the minimum
cacheable prefix is 4096 tokens. A bare schema is a few hundred tokens and would
silently never cache. The system prompt therefore ships a full operator playbook
(a data dictionary, query conventions, worked patterns, an anti-pattern
appendix) in [`lib/env/seed.ts`](lib/env/seed.ts). That content is genuinely
useful context for writing correct SQL, and it pushes the stable prefix across
the cache floor, so every turn after the first reads roughly four thousand tokens
from cache at one tenth the price instead of paying full rate. You can watch this
on any run detail page: `cache read` climbs with step count while `input
(uncached)` stays near the size of the task prompt and the growing tool-result
tail.

### Rate-limit backoff

`createWithBackoff` in the runner retries on HTTP 429 and on 5xx, honoring the
`retry-after` header when present and otherwise backing off exponentially with
jitter, capped, for a bounded number of attempts. Every retry is counted onto the
run's `retries` field, so the dashboard shows backpressure as a first-class
number next to cost and latency rather than hiding it in logs. Under a burst, the
Anthropic SDK's own retry plus this loop is what keeps a fleet of workers from
hammering a rate-limited endpoint.

## Running many at once

The unit of horizontal scale is the worker in [`infra/worker/worker.ts`](infra/worker/worker.ts).
It `BLPOP`s task descriptors off a Redis list, runs the episode through the same
runner, and emits one structured JSON log line per completed run with the run id,
model, reward, cost, cache hit rate, retries, and token breakdown. Those fields
are what a log pipeline indexes next to the Kubernetes pod metadata, which is how
"this pod" and "this run" end up joinable.

Scaling is queue-driven. [`infra/k8s/keda-scaledobject.yaml`](infra/k8s/keda-scaledobject.yaml)
points KEDA at the Redis list length and scales the worker Deployment between 2
and 24 replicas with a target of 20 queued tasks per replica. The backlog, not
CPU, is the signal, because a worker waiting on a slow model call is not
CPU-bound and CPU-based autoscaling would under-provision exactly when the queue
is deepest. An [`hpa.yaml`](infra/k8s/hpa.yaml) is included as a CPU fallback for
clusters without KEDA, with the tradeoff noted inline.

Generate load with `scripts/enqueue.mjs` and watch the queue-depth chart on the
dashboard rise, the autoscaler add workers, and the backlog drain. The two scale
events and the OOM restart in the cluster event feed are the kind of signal this
layer exists to surface.

## The dashboard

[`app/page.tsx`](app/page.tsx) renders three things together:

- **Model behavior**: pass rate, reward, cache hit rate, and cost per run, broken
  out by model and by environment, with a reward-distribution histogram and spend
  over time. Charts are hand-rolled inline SVG ([`components/charts.tsx`](components/charts.tsx)),
  so there is no chart dependency and everything renders on the server.
- **Pod health**: replicas (current versus desired), queue depth over the window,
  a per-pod table with CPU and memory sparklines against their limits, and a
  cluster event feed.
- **Run an agent**: pick an environment, model, and effort, and execute a live
  run against the real model and verifier, with the trajectory and metered cost
  shown inline.

Every recent run links to a detail page ([`app/runs/[id]/page.tsx`](app/runs/%5Bid%5D/page.tsx))
with the full token accounting, scheduling metadata, and step-by-step trajectory.

## Design decisions and tradeoffs

**Pure-JS SQL over a real database.** alasql means an environment instance has no
native dependency, no WASM asset, and no provisioning, so it runs identically in
a serverless function and a worker pod and resets in microseconds. The cost is
dialect coverage: alasql is not Postgres, so environments that need window
functions, CTEs, or strict type semantics would outgrow it. For a verifier-graded
ops console it is the right tradeoff; for a SQL-correctness benchmark it would not
be, and you would swap the engine behind the same environment contract.

**One runner, two surfaces.** Sharing `lib/agent/runner.ts` between the dashboard
and the worker eliminates eval-versus-production drift, at the cost of coupling
the web app and the worker to the same module. They are in one repo and versioned
together precisely so that coupling is cheap.

**A long system prompt on purpose.** Padding the prefix to clear the 4096-token
cache floor trades a larger first-turn cache write for cheap reads on every
subsequent turn. For multi-step tool loops that re-send the prefix each turn this
pays off after the first turn; for a single-shot classification it would be pure
overhead, and you would shrink the prompt and accept no caching.

**Queue depth over CPU for autoscaling.** Correct for I/O-bound model calls,
requires KEDA. CPU-based HPA is the dependency-free fallback and is included, with
the caveat that it under-scales a queue of slow calls.

**A recorded window plus live runs.** The dashboard reads a recorded window from
`data/` and merges any runs executed in-process on top. On a long-lived worker or
in local dev this accumulates; on Vercel's per-invocation isolation the live
merge is per-instance and the recorded window is the durable history. For
durable multi-instance history you would point `lib/data/store.ts` at Postgres or
Vercel KV, which is the natural next step and why the store is a single module.

**Serverless run duration.** A live run on the dashboard executes inside one
serverless invocation, bounded by `maxDuration` (60s in `vercel.json`). Long
multi-step runs belong on the worker, where there is no request timeout. The
dashboard live run is for a quick check, not a batch.

## Prior art

podbench borrows the shape of a good environment from several places and is
narrower than all of them on purpose.

- **SWE-bench** grades by running a hidden test suite against a real repository.
  podbench takes the programmatic-verifier idea (grade the world, not the prose)
  and applies it to a fast, resettable database instead of a repo checkout, which
  is what makes thousands of concurrent resets cheap.
- **WebArena** and **BrowserGym** put the agent in a real web application with
  state. podbench keeps the stateful-environment-with-a-checker idea but drops
  the browser, trading task realism for a deterministic, millisecond-reset world
  that runs in a serverless function.
- **OSWorld** scores real computer-use tasks across applications. podbench shares
  the execution-based scoring philosophy on a far smaller, fully sandboxed action
  surface.
- **terminal-bench** runs agents in a terminal sandbox with task-specific checks.
  podbench's `run_sql`-and-`submit` surface is a deliberately smaller cousin, and
  the worker plus container plus autoscaler layer is what this project adds on top
  of the single-sandbox model: the harness for running the sandbox at fleet scale
  with the cost and health observability that implies.

The thing podbench is built to demonstrate that those mostly leave out is the
operational layer: token metering wired into the loop, backoff and caching as
first-class measured quantities, and pod health rendered next to model behavior.

## Getting started

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env            # add ANTHROPIC_API_KEY to run live
npm run dev                     # dashboard at http://localhost:3000
```

The dashboard renders the recorded window out of the box. Set `ANTHROPIC_API_KEY`
to enable the "Run an agent" panel and the backfill.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (none) | Required for live runs and backfill. |
| `PODBENCH_MODEL` | `claude-opus-4-8` | Policy model id. |
| `PODBENCH_EFFORT` | `medium` | Effort hint: low, medium, or high. |
| `PODBENCH_ENV_NOW` | `2026-06-15` | Pinned clock for environment date math. |
| `REDIS_URL` | (none) | Worker queue backend; empty runs an in-process smoke batch. |
| `PODBENCH_QUEUE` | `podbench:tasks` | Redis list name for tasks. |

## Deploy on Vercel

The dashboard is a standard Next.js app and is Vercel-native.

1. Import the repository in Vercel.
2. Add `ANTHROPIC_API_KEY` as an environment variable (and optionally
   `PODBENCH_MODEL`, `PODBENCH_EFFORT`).
3. Deploy.

`vercel.json` raises `maxDuration` on `/api/run` to 60 seconds for live runs.
`next.config.mjs` marks alasql as a server-external package and traces the `data/`
files into the serverless bundle so the API can read the recorded window.

## Run the fleet on Kubernetes

```bash
kubectl apply -f infra/k8s/namespace.yaml
kubectl -n podbench create secret generic podbench-secrets \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...
kubectl apply -f infra/k8s/redis.yaml
kubectl apply -f infra/k8s/worker-deployment.yaml
kubectl apply -f infra/k8s/keda-scaledobject.yaml   # or hpa.yaml without KEDA

# generate load and watch it scale
REDIS_URL=redis://localhost:6379 node scripts/enqueue.mjs 300
```

Build the worker image from [`infra/Dockerfile.worker`](infra/Dockerfile.worker).
Workers report per-run metering as structured logs for a log pipeline to index
next to pod metadata.

## Backfill real runs

To replace the recorded window with genuine runs against the live model:

```bash
ANTHROPIC_API_KEY=sk-ant-... BACKFILL_RUNS=24 npx tsx scripts/backfill.ts
```

This executes real episodes across the environments and models, writes the
results to `data/runs.json`, and reconciles per-pod `runs_handled` in
`data/fleet.json`. Cost scales with `BACKFILL_RUNS` and the chosen models, so
start small.

## Adding an environment

Add a `Task` to [`lib/env/tasks.ts`](lib/env/tasks.ts) with a `prompt` and a
`verify` function. For question tasks, compute ground truth from a freshly seeded
database and compare to `submission.answer`. For state tasks, inspect the database
the agent left behind and return weighted partial credit. Keep `verify`
deterministic and model-free, and it will show up on the dashboard automatically.

## Repository layout

```
app/                  Next.js dashboard and JSON API
  api/                runs, run, fleet, stats endpoints
  runs/[id]/          per-run detail page
components/           inline SVG charts and the live-run client panel
lib/
  env/                deterministic environment: seed, tasks, verifiers
  agent/              runner, pricing, cost and cache math
  data/               run store and aggregate stats
infra/
  worker/             horizontally scaled queue consumer
  k8s/                namespace, redis, worker, KEDA, HPA
  Dockerfile.worker   worker image
scripts/              dataset generation, backfill, queue load generator
data/                 recorded run window and fleet snapshot
```

## Limitations

- The reference environment is single-table-ish SQL ops; richer worlds (a real
  app, a browser, a filesystem) are future environments behind the same contract.
- The recorded fleet snapshot is a window, not a live cluster feed; wiring the
  dashboard to the Kubernetes metrics API and a live log stream is the next step
  and is intentionally decoupled behind `lib/data/store.ts`.
- alasql dialect coverage bounds what SQL tasks can express; see Tradeoffs.

## License

Apache-2.0. See [LICENSE](LICENSE).
