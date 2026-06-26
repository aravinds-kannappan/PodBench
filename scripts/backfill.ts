// Executes real agent episodes against the live model and writes the results to
// data/runs.json, replacing the recorded window with genuine runs. Pod names and
// runs_handled in data/fleet.json are reconciled to match.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/backfill.ts
//
// Tunables (env):
//   BACKFILL_RUNS     total episodes to execute (default 24)
//   BACKFILL_MODELS   comma list of model ids (default opus/sonnet/haiku)
//   BACKFILL_CONC     max concurrent episodes (default 3)
//   PODBENCH_EFFORT   low | medium | high (default medium)
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runEpisode } from "../lib/agent/runner";
import { TASKS } from "../lib/env/tasks";
import type { Run } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error("OPENROUTER_API_KEY or ANTHROPIC_API_KEY is required to backfill real runs.");
  process.exit(1);
}

const TOTAL = Number(process.env.BACKFILL_RUNS ?? "24");
const MODELS = (process.env.BACKFILL_MODELS ??
  "claude-opus-4-8,claude-sonnet-4-6,claude-haiku-4-5")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CONC = Number(process.env.BACKFILL_CONC ?? "3");
const EFFORT = process.env.PODBENCH_EFFORT ?? "medium";

// Reconcile pod assignment with the fleet snapshot so the dashboard stays
// coherent: real runs get attributed to the same worker pods shown in the
// pod-health view.
function fleetPods(): string[] {
  const f = join(DATA_DIR, "fleet.json");
  if (existsSync(f)) {
    const fleet = JSON.parse(readFileSync(f, "utf8"));
    const pods = (fleet.pods ?? [])
      .filter((p: any) => p.phase !== "Pending")
      .map((p: any) => p.name);
    if (pods.length) return pods;
  }
  return ["podbench-worker-a", "podbench-worker-b", "podbench-worker-c"];
}

const POOL = fleetPods();
const MODEL_WEIGHTS = [0.55, 0.3, 0.15];

function pickModel(): string {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < MODELS.length; i++) {
    acc += MODEL_WEIGHTS[i] ?? 1 / MODELS.length;
    if (r <= acc) return MODELS[i];
  }
  return MODELS[0];
}

async function pool<T>(items: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await items[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function main() {
  console.log(
    `backfilling ${TOTAL} real runs across ${MODELS.join(", ")} (conc=${CONC})`
  );
  const jobs: (() => Promise<Run>)[] = [];
  for (let k = 0; k < TOTAL; k++) {
    const task = TASKS[Math.floor(Math.random() * TASKS.length)];
    const model = pickModel();
    const pod = POOL[k % POOL.length];
    const queue = Math.random() < 0.7 ? "redis" : "sqs";
    jobs.push(async () => {
      const run = await runEpisode(task.id, {
        model,
        effort: EFFORT,
        pod,
        queue: queue as "redis" | "sqs",
      });
      console.log(
        `  ${run.passed ? "PASS" : "fail"} ${run.task_id} (${run.model}) ` +
          `reward=${run.reward} cost=$${run.cost_usd.toFixed(4)} cache=${(run.cache_hit_rate * 100).toFixed(0)}%`
      );
      return run;
    });
  }

  const runs = await pool(jobs, CONC);
  runs.sort((a, b) => a.started_at.localeCompare(b.started_at));
  writeFileSync(join(DATA_DIR, "runs.json"), JSON.stringify(runs, null, 2));

  // reconcile runs_handled in the fleet snapshot
  const fleetPath = join(DATA_DIR, "fleet.json");
  if (existsSync(fleetPath)) {
    const fleet = JSON.parse(readFileSync(fleetPath, "utf8"));
    const handled: Record<string, number> = {};
    for (const r of runs) handled[r.pod] = (handled[r.pod] ?? 0) + 1;
    for (const p of fleet.pods) p.runs_handled = handled[p.name] ?? 0;
    writeFileSync(fleetPath, JSON.stringify(fleet, null, 2));
  }

  const passes = runs.filter((r) => r.passed).length;
  const cost = runs.reduce((s, r) => s + r.cost_usd, 0);
  console.log(
    `\ndone: ${runs.length} runs, pass rate ${((passes / runs.length) * 100).toFixed(1)}%, total cost $${cost.toFixed(4)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
