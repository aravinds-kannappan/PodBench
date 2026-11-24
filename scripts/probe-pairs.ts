// Preview by default. Live mode streams JSON Lines so a completed arm survives
// interruption. These experiments never replace the dashboard's recorded runs.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { activeProvider, credentialHint, hasCredentials, resolveModelId } from "../lib/agent/llm";
import { episodePrompts, PROBE_METHODS, type PromptCondition } from "../lib/agent/probe-prompts";
import { runEpisode } from "../lib/agent/runner";
import { getTask } from "../lib/env/tasks";
import type { Run } from "../lib/types";

const usage = `Usage: npm run --silent probe:pairs -- [--method suffix|format|reminder]
  [--task TASK_ID] [--pairs COUNT] [--model MODEL_ID] [--live]

The default prints the two prompt conditions without calling a model.
--live executes two metered episodes per pair and streams JSON Lines to stdout.`;

function emit(value: unknown) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean" },
      live: { type: "boolean" },
      method: { type: "string", default: "suffix" },
      task: { type: "string", default: "scope-creep-oversell" },
      pairs: { type: "string", default: "1" },
      model: { type: "string", default: process.env.PODBENCH_MODEL || "claude-opus-4-8" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }

  const method = PROBE_METHODS.find((name) => name === values.method);
  if (!method) throw new Error(`Unknown method. Choose one of ${PROBE_METHODS.join(", ")}.`);
  const task = getTask(values.task);
  if (!task) throw new Error(`Unknown task: ${values.task}`);
  const pairs = Number(values.pairs);
  if (!Number.isSafeInteger(pairs) || pairs < 1 || !Number.isSafeInteger(pairs * 2)) {
    throw new Error("--pairs must be a positive integer within the safe episode count range.");
  }
  const maxTokens = Number(process.env.PODBENCH_MAX_TOKENS || 1500);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error("Invalid PODBENCH_MAX_TOKENS");

  const model = values.model.trim();
  if (!model) throw new Error("--model must be a nonempty model ID.");
  const effort = process.env.PODBENCH_EFFORT || "medium";
  const maxSteps = 14;
  const provider = activeProvider();
  const conditions: PromptCondition[] = ["baseline", method];
  const plan = {
    task: task.id,
    method,
    model,
    requested_effort: effort,
    max_steps: maxSteps,
    max_tokens: maxTokens,
    pairs,
    episodes: pairs * 2,
    order: "Baseline first on odd pairs, treatment first on even pairs.",
    // An empty prefix exposes only the experimental addition to the system.
    prompts: conditions.map((condition) => {
      const { user, system } = episodePrompts(task.prompt, "", condition);
      return { condition, user, system_addition: system.trimStart() };
    }),
  };
  if (!values.live) {
    emit({ type: "plan", ...plan });
    return;
  }
  if (!hasCredentials()) throw new Error(credentialHint());

  const experiment = randomUUID();
  emit({
    type: "experiment",
    experiment,
    provider,
    api_model: resolveModelId(model, provider),
    ...plan,
  });
  const transitions = { pass_pass: 0, pass_fail: 0, fail_pass: 0, fail_fail: 0 };
  let scoredPairs = 0;
  let behavioralPairs = 0;
  let flagDisagreements = 0;
  for (let pair = 1; pair <= pairs; pair++) {
    const order = pair % 2 ? conditions : [...conditions].reverse();
    const arms = new Map<PromptCondition, Run>();
    for (const condition of order) {
      const run = await runEpisode(task.id, { model, effort, maxSteps, promptCondition: condition });
      emit({ type: "episode", experiment, pair, condition, run });
      arms.set(condition, run);
    }
    const baseline = arms.get("baseline")!;
    const treatment = arms.get(method)!;
    if (baseline.status === "error" || treatment.status === "error") continue;
    scoredPairs++;
    const from = baseline.passed ? "pass" : "fail";
    const to = treatment.passed ? "pass" : "fail";
    transitions[`${from}_${to}`]++;
    if (!baseline.propensity || !treatment.propensity) continue;
    if (task.redirect && (!baseline.redirect_observed || !treatment.redirect_observed)) continue;
    behavioralPairs++;
    const baselineFlags = [...baseline.propensity.flags].sort().join(",");
    const treatmentFlags = [...treatment.propensity.flags].sort().join(",");
    if (baselineFlags !== treatmentFlags) flagDisagreements++;
  }
  emit({
    type: "summary",
    experiment,
    pairs,
    scored_pairs: scoredPairs,
    error_pairs: pairs - scoredPairs,
    baseline_passes: transitions.pass_pass + transitions.pass_fail,
    treatment_passes: transitions.pass_pass + transitions.fail_pass,
    transitions,
    behavioral_pairs: behavioralPairs,
    flag_disagreements: flagDisagreements,
  });
  if (scoredPairs < pairs) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
