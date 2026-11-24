// Validate the streamed episode records before trusting aggregate counts.
export function readExperiment(input) {
  const lines = input.trimEnd().split(/\r?\n/);
  let plan;
  let summary;
  let incompleteLine = false;
  const pairs = new Map();
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const invalid = (reason) => { throw new Error(`Line ${index + 1}: ${reason}`); };
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      if (plan && !summary && index === lines.length - 1 && !input.endsWith("\n")) {
        incompleteLine = true;
        break;
      }
      invalid("invalid JSON. Select the JSONL output from probe:pairs --live.");
    }
    if (!record || typeof record !== "object") invalid("expected an experiment record.");
    if (!plan) {
      if (record.type === "plan") invalid("this is a preview. Select output from a live comparison.");
      if (record.type !== "experiment" || !["suffix", "format", "reminder"].includes(record.method)
        || ![record.task, record.model, record.experiment].every((s) => typeof s === "string" && s.trim())
        || !Number.isSafeInteger(record.pairs) || record.pairs < 1) invalid("invalid experiment header.");
      plan = record;
      continue;
    }
    if (summary || record.experiment !== plan.experiment) invalid("expected records from exactly one experiment.");
    if (record.type === "summary") {
      summary = record;
      continue;
    }
    if (record.type !== "episode" || !Number.isSafeInteger(record.pair) || record.pair < 1
      || record.pair > plan.pairs || !["baseline", plan.method].includes(record.condition)) invalid("invalid paired episode.");
    const run = record.run;
    if (run?.task_id !== plan.task || run.model !== plan.model || run.source !== "live"
      || !["passed", "failed", "error"].includes(run.status) || run.passed !== (run.status === "passed")) {
      invalid("episode metadata or verdict differs from the experiment format.");
    }
    if (run.propensity != null && (!Array.isArray(run.propensity.flags)
      || !run.propensity.flags.every((flag) => typeof flag === "string"))) invalid("invalid behavioral flags.");
    if (run.redirect_observed !== undefined && typeof run.redirect_observed !== "boolean") invalid("invalid stop exposure.");
    const arms = pairs.get(record.pair) ?? new Map();
    if (arms.has(record.condition)) invalid("duplicate condition for this pair.");
    arms.set(record.condition, run);
    pairs.set(record.pair, arms);
  }
  if (!plan) throw new Error("Select a JSONL file containing a probe:pairs experiment.");

  const transitions = { pass_pass: 0, pass_fail: 0, fail_pass: 0, fail_fail: 0 };
  let errors = 0, scored = 0, behavioral = 0, disagreements = 0;
  for (const arms of pairs.values()) {
    if (arms.size !== 2) continue;
    const base = arms.get("baseline");
    const changed = arms.get(plan.method);
    if (base.status === "error" || changed.status === "error") {
      errors++;
      continue;
    }
    scored++;
    transitions[`${base.passed ? "pass" : "fail"}_${changed.passed ? "pass" : "fail"}`]++;
    const stopTask = plan.task === "redirection-merge" || [base, changed].some((r) => r.propensity?.probe === "redirection");
    if (!base.propensity || !changed.propensity || (stopTask && !(base.redirect_observed && changed.redirect_observed))) continue;
    behavioral++;
    const flags = (arm) => JSON.stringify([...arm.propensity.flags].sort());
    if (flags(base) !== flags(changed)) disagreements++;
  }
  const counts = {
    pairs: plan.pairs,
    scored_pairs: scored,
    error_pairs: errors,
    baseline_passes: transitions.pass_pass + transitions.pass_fail,
    treatment_passes: transitions.pass_pass + transitions.fail_pass,
    behavioral_pairs: behavioral,
    flag_disagreements: disagreements,
  };
  const missing = plan.pairs - scored - errors;
  if (summary && (missing || Object.entries(counts).some(([k, v]) => summary[k] !== v)
    || Object.entries(transitions).some(([k, v]) => summary.transitions?.[k] !== v))) {
    throw new Error("The final summary disagrees with the episode records. Check that the export is complete.");
  }
  return { plan, counts, transitions, missing, partial: !summary, incompleteLine };
}

function renderReport(report) {
  const { plan, counts, transitions, missing } = report;
  const byId = (id) => document.getElementById(id);
  byId("pair-meta").textContent = `${plan.task} · ${plan.model} · ${plan.method}`;
  byId("pair-coverage").textContent = `${counts.scored_pairs} scored pairs · ${counts.error_pairs} complete pairs with errors · ${missing} missing or unfinished pairs · ${plan.pairs} planned`;
  const bars = byId("pair-bars");
  bars.replaceChildren();
  for (const [name, passed] of [["Baseline", counts.baseline_passes], [plan.method, counts.treatment_passes]]) {
    const row = bars.insertRow();
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = name;
    row.append(label);
    const rate = row.insertCell();
    if (counts.scored_pairs) {
      const meter = document.createElement("meter");
      meter.max = counts.scored_pairs;
      meter.value = passed;
      meter.setAttribute("aria-label", `${name} pass rate`);
      rate.append(meter, ` ${Math.round(100 * passed / counts.scored_pairs)}%`);
    } else rate.textContent = "Unscored";
    row.insertCell().textContent = `${passed} / ${counts.scored_pairs}`;
  }
  byId("pair-transitions").textContent = `Passed both: ${transitions.pass_pass}. Passed only the baseline: ${transitions.pass_fail}. Passed only the treatment: ${transitions.fail_pass}. Failed both: ${transitions.fail_fail}.`;
  byId("pair-flags").textContent = `Behavioral flags differed in ${counts.flag_disagreements} of ${counts.behavioral_pairs} eligible pairs.`;
}

if (typeof document !== "undefined") {
  const picker = document.getElementById("pair-file");
  picker.addEventListener("change", async () => {
    const report = document.getElementById("pair-report");
    const status = document.getElementById("pair-status");
    const file = picker.files[0];
    report.hidden = true;
    status.textContent = "";
    if (!file) return;
    try {
      const input = await file.text();
      if (picker.files[0] !== file) return;
      const result = readExperiment(input);
      renderReport(result);
      report.hidden = false;
      status.textContent = result.partial ? "Partial export. Counts include completed pairs only." : "Complete export.";
      if (result.incompleteLine) status.textContent += " The unreadable final line was skipped.";
    } catch (error) {
      if (picker.files[0] === file) status.textContent = error.message;
    }
  });
}
