// Build the public, trace-free Pages dataset from the committed run corpus.
// Use --check in CI to detect stale artifacts without modifying the checkout.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const sourceFile = new URL("../data/runs.json", import.meta.url);
const outputFile = new URL("../docs/results.json", import.meta.url);
const input = await readFile(sourceFile);
const runs = JSON.parse(input);
const seen = new Set();

function publicRecord(run) {
  for (const field of ["id", "task_id", "task_title", "model", "status", "started_at"]) {
    if (typeof run[field] !== "string" || !run[field].trim()) {
      throw new Error(`Missing ${field} on run ${run.id ?? "(unknown)"}`);
    }
  }
  if (seen.has(run.id)) throw new Error(`Duplicate run ID: ${run.id}`);
  seen.add(run.id);
  if (typeof run.passed !== "boolean") throw new Error(`Missing passed on ${run.id}`);

  const p = run.propensity;
  return {
    id: run.id,
    task_id: run.task_id,
    task_title: run.task_title,
    difficulty: run.difficulty ?? null,
    model: run.model,
    status: run.status,
    passed: run.passed,
    reward: run.reward ?? null,
    steps: run.steps ?? null,
    started_at: run.started_at,
    latency_ms: run.latency_ms ?? null,
    cost_usd: run.cost_usd ?? null,
    source: ["live", "simulated"].includes(run.source) ? run.source : "unknown",
    probe: p?.probe ?? (typeof run.redirect_observed === "boolean" ? "redirection" : null),
    flags: p?.flags ?? null,
    propensity_score: p?.score ?? null,
    // Legacy reports omit the delivery marker. A positive post-stop count is
    // conclusive; zero post-stop writes alone cannot establish delivery.
    redirect_observed: run.redirect_observed ?? (p?.writes_after_redirect > 0 ? true : null),
    writes_after_redirect: p?.writes_after_redirect ?? null,
  };
}

const result = {
  schema_version: 1,
  source_path: "data/runs.json",
  source_sha256: createHash("sha256").update(input).digest("hex"),
  runs: runs.map(publicRecord),
};
const output = JSON.stringify(result) + "\n";
if (process.argv.length === 2) {
  await writeFile(outputFile, output);
  console.log(`Exported ${runs.length} records to docs/results.json.`);
} else if (process.argv.length === 3 && process.argv[2] === "--check") {
  if ((await readFile(outputFile, "utf8")) !== output) {
    throw new Error("Stale docs/results.json. Run node scripts/export-results.mjs.");
  }
  console.log(`Verified ${runs.length} exported records.`);
} else {
  throw new Error("Usage: node scripts/export-results.mjs [--check]");
}
