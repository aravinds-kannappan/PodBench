// podbench worker.
//
// Pulls task descriptors off a queue, runs the agent episode against the
// deterministic environment, scores it with the verifier, and reports the
// result plus token metering. This is the unit the Kubernetes Deployment scales
// horizontally; the HorizontalPodAutoscaler watches queue depth and adds or
// removes replicas of this process.
//
// Two queue backends:
//   - Redis (a stream/list at REDIS_URL). Used when REDIS_URL is set.
//   - In-process. A fixed batch of tasks is enqueued and drained. Used for a
//     local smoke test when no broker is available.
//
// The same runEpisode used by the dashboard's /api/run runs here, so live UI
// runs and fleet runs are byte-for-byte the same code path.
import { runEpisode } from "../../lib/agent/runner";
import { TASKS } from "../../lib/env/tasks";
import type { Run } from "../../lib/types";

const POD = process.env.HOSTNAME || `podbench-worker-${Math.random().toString(16).slice(2, 7)}`;
const QUEUE = process.env.PODBENCH_QUEUE || "podbench:tasks";
const REDIS_URL = process.env.REDIS_URL || "";
const MODEL = process.env.PODBENCH_MODEL || "claude-opus-4-8";
const EFFORT = process.env.PODBENCH_EFFORT || "medium";
const IDLE_EXIT_MS = Number(process.env.PODBENCH_IDLE_EXIT_MS || "0");

interface TaskMsg {
  task_id: string;
  model?: string;
  effort?: string;
}

function log(obj: Record<string, unknown>): void {
  // structured logs so a log pipeline (Loki, CloudWatch) can index pod, run, and
  // model fields next to the Kubernetes pod metadata.
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), pod: POD, ...obj }) + "\n");
}

function reportRun(run: Run): void {
  log({
    level: "info",
    event: "run_complete",
    run_id: run.id,
    task: run.task_id,
    model: run.model,
    status: run.status,
    reward: run.reward,
    steps: run.steps,
    cost_usd: run.cost_usd,
    cache_hit_rate: run.cache_hit_rate,
    retries: run.retries,
    latency_ms: run.latency_ms,
    input_tokens: run.usage.input_tokens,
    output_tokens: run.usage.output_tokens,
    cache_read_input_tokens: run.usage.cache_read_input_tokens,
    cache_creation_input_tokens: run.usage.cache_creation_input_tokens,
  });
}

async function handle(msg: TaskMsg): Promise<void> {
  log({ level: "info", event: "run_start", task: msg.task_id, model: msg.model || MODEL });
  try {
    const run = await runEpisode(msg.task_id, {
      model: msg.model || MODEL,
      effort: msg.effort || EFFORT,
      pod: POD,
      queue: REDIS_URL ? "redis" : "sqs",
    });
    reportRun(run);
  } catch (e: any) {
    log({ level: "error", event: "run_error", task: msg.task_id, error: e?.message ?? String(e) });
  }
}

async function runRedis(): Promise<void> {
  // ioredis is a devDependency; only loaded on this path.
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(REDIS_URL);
  log({ level: "info", event: "worker_ready", backend: "redis", queue: QUEUE });
  let idleSince = Date.now();
  for (;;) {
    // BLPOP blocks up to 5s for the next task; the broker is the work signal the
    // HPA scales on (queue depth = LLEN of this key).
    const res = await redis.blpop(QUEUE, 5);
    if (!res) {
      if (IDLE_EXIT_MS > 0 && Date.now() - idleSince > IDLE_EXIT_MS) {
        log({ level: "info", event: "idle_exit" });
        await redis.quit();
        return;
      }
      continue;
    }
    idleSince = Date.now();
    let msg: TaskMsg;
    try {
      msg = JSON.parse(res[1]);
    } catch {
      log({ level: "warn", event: "bad_message", raw: res[1] });
      continue;
    }
    await handle(msg);
  }
}

async function runInProcess(): Promise<void> {
  log({ level: "info", event: "worker_ready", backend: "in-process" });
  // Enqueue one of each environment as a smoke batch.
  const batch: TaskMsg[] = TASKS.map((t) => ({ task_id: t.id, model: MODEL, effort: EFFORT }));
  for (const msg of batch) {
    await handle(msg);
  }
  log({ level: "info", event: "batch_complete", count: batch.length });
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    log({ level: "error", event: "missing_key", message: "ANTHROPIC_API_KEY is required" });
    process.exit(1);
  }
  if (REDIS_URL) await runRedis();
  else await runInProcess();
}

process.on("SIGTERM", () => {
  log({ level: "info", event: "sigterm", message: "draining and exiting" });
  process.exit(0);
});

main().catch((e) => {
  log({ level: "error", event: "fatal", error: e?.message ?? String(e) });
  process.exit(1);
});
