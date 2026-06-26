// Budget-capped real backfill. Runs real episodes across the full model lineup,
// prioritizing the three propensity probes, and stops launching new runs once
// cumulative OpenRouter spend crosses FILL_BUDGET. Sequential so the cap is
// precise. Writes only successful runs to data/runs.json and reconciles per-pod
// runs_handled in data/fleet.json.
//
//   set -a; . ./.env; set +a
//   FILL_BUDGET=4.3 PODBENCH_MAX_TOKENS=1000 npx tsx scripts/backfill-budget.ts
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runEpisode } from "../lib/agent/runner";
import type { Run } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");

if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error("OPENROUTER_API_KEY or ANTHROPIC_API_KEY required.");
  process.exit(1);
}

const BUDGET = Number(process.env.FILL_BUDGET || "4.3"); // stop launching past this
const MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "gpt-5.5-pro",
  "gpt-5.5",
  "gemini-3.1-pro",
  "gemini-3.5-flash",
];
const PROBES = ["scope-creep-oversell", "test-gaming-refund", "redirection-merge"];
const CAP = [
  "top-spender-email",
  "count-stale-processing",
  "revenue-by-category",
  "refund-order",
  "fix-oversell",
  "dedup-customers",
];
// cheaper models first in the capability phase, so if budget runs low the
// expensive models simply get fewer capability runs (probes already cover them).
const CHEAP_FIRST = [
  "gemini-3.5-flash",
  "gpt-5.5",
  "gemini-3.1-pro",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "gpt-5.5-pro",
];

function buildJobs(): { task: string; model: string }[] {
  const jobs: { task: string; model: string }[] = [];
  for (const p of PROBES) for (const m of MODELS) jobs.push({ task: p, model: m });
  for (const t of CAP) for (const m of CHEAP_FIRST) jobs.push({ task: t, model: m });
  return jobs;
}

function fleetPods(): string[] {
  try {
    const f = JSON.parse(readFileSync(join(DATA, "fleet.json"), "utf8"));
    const pods = (f.pods ?? [])
      .filter((p: any) => p.phase !== "Pending")
      .map((p: any) => p.name);
    if (pods.length) return pods;
  } catch {
    /* ignore */
  }
  return ["podbench-worker-a", "podbench-worker-b", "podbench-worker-c"];
}

function reconcileFleet(runs: Run[]): void {
  const fp = join(DATA, "fleet.json");
  if (!existsSync(fp)) return;
  const fleet = JSON.parse(readFileSync(fp, "utf8"));
  const handled: Record<string, number> = {};
  for (const r of runs) handled[r.pod] = (handled[r.pod] ?? 0) + 1;
  for (const p of fleet.pods) p.runs_handled = handled[p.name] ?? 0;
  writeFileSync(fp, JSON.stringify(fleet, null, 2));
}

async function main() {
  const jobs = buildJobs();
  const pods = fleetPods();
  const good: Run[] = [];
  let spend = 0;
  let errors = 0;
  let k = 0;
  console.log(`budget $${BUDGET} | ${jobs.length} jobs queued | ${MODELS.length} models`);

  for (const job of jobs) {
    if (spend >= BUDGET) {
      console.log(`\n== budget cutoff: $${spend.toFixed(3)} >= $${BUDGET}, stopping ==`);
      break;
    }
    try {
      const run = await runEpisode(job.task, {
        model: job.model,
        effort: "low",
        maxSteps: 10,
        pod: pods[k % pods.length],
        queue: k % 3 === 0 ? "sqs" : "redis",
      });
      k++;
      if (run.status === "error") {
        errors++;
        const e = String(run.error ?? "");
        console.log(`ERR  ${job.model} / ${job.task}: ${e.slice(0, 70)}`);
        if (e.includes("402")) {
          console.log("== 402 insufficient credit, stopping ==");
          break;
        }
        continue;
      }
      spend += run.cost_usd;
      good.push(run);
      const flags = run.propensity?.flags.join(",") || "clean";
      console.log(
        `${run.passed ? "PASS" : "fail"} ${job.model.padEnd(17)} ${job.task.padEnd(22)} ` +
          `r=${run.reward.toFixed(2)} trust=${run.propensity?.score.toFixed(2) ?? "-"} [${flags}] ` +
          `$${run.cost_usd.toFixed(4)} | total $${spend.toFixed(3)} (${good.length})`
      );
      // checkpoint so a crash keeps results
      writeFileSync(join(DATA, "runs.live.json"), JSON.stringify(good, null, 2));
    } catch (e: any) {
      errors++;
      const msg = String(e?.message ?? e);
      console.log(`THREW ${job.model} / ${job.task}: ${msg.slice(0, 70)}`);
      if (msg.includes("402")) {
        console.log("== 402 insufficient credit, stopping ==");
        break;
      }
    }
  }

  if (good.length >= 12) {
    good.sort((a, b) => a.started_at.localeCompare(b.started_at));
    writeFileSync(join(DATA, "runs.json"), JSON.stringify(good, null, 2));
    reconcileFleet(good);
    console.log(`\nwrote ${good.length} REAL runs -> data/runs.json`);
  } else {
    console.log(`\nonly ${good.length} clean runs (<12) — left data/runs.json unchanged; see data/runs.live.json`);
  }
  const passes = good.filter((r) => r.passed).length;
  console.log(
    `done: ${good.length} runs, ${errors} errors, pass ${good.length ? ((passes / good.length) * 100).toFixed(0) : 0}%, spend $${spend.toFixed(3)}`
  );
}

main().catch((e) => {
  console.error("fatal:", e?.message ?? e);
  process.exit(1);
});
