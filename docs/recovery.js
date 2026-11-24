"use strict";

(() => {
  const get = (key) => document.getElementById(key);
  const models = {"qwen2.5-0.5b": "Qwen2.5-0.5B-Instruct", "smollm2-360m": "SmolLM2-360M-Instruct"};
  const families = {refund: "Refund reconciliation", inventory: "Inventory receipt", transfer: "Customer transfer"};
  const instructions = {baseline: "Generic recovery request", inspect_first: "Inspect-first instruction"};
  const shortPct = new Intl.NumberFormat("en", {style: "percent", maximumFractionDigits: 1});
  const point = new Intl.NumberFormat("en", {maximumFractionDigits: 1, signDisplay: "exceptZero"});
  const points = (value) => point.format(100 * value);
  const raw = "https://github.com/aravinds-kannappan/PodBench/blob/recovery-v1.0.0/research/recovery/episodes.jsonl";

  function el(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function sum(rows, key) { return rows.reduce((total, r) => total + r[key], 0); }

  function recoveryBar(rows, instruction, metric) {
    const cells = rows.filter((r) => r.instruction === instruction);
    const measures = {
      exact: ["passed", "scheduled", " exact recovery"],
      submitted: ["submitted", "scheduled", " explicitly submitted"],
      inspect: ["first_inspection", "first_decisions", " inspected first"],
    };
    const [numerator, denominator, outcome] = measures[metric];
    const n = sum(cells, denominator);
    const count = sum(cells, numerator);
    const fig = el("figure", undefined, "recovery-bars");
    const caption = el("figcaption");
    caption.append(el("span", instructions[instruction]), el("strong", count + "/" + n));
    const track = el("div", undefined, instruction === "baseline" ? "study-track" : "study-track study-treatment");
    track.setAttribute("aria-hidden", "true");
    const fill = el("i");
    fill.style.width = (n ? count * 100 / n : 0) + "%";
    track.append(fill);
    fig.append(caption, track, el("div", n ? shortPct.format(count / n) + outcome : "No eligible episodes", "study-counts"));
    return fig;
  }

  function modelResults(data) {
    const output = get("recovery-chart");
    output.replaceChildren();
    const metric = get("recovery-metric").value;
    for (const model of data.by_model) {
      const rows = data.cells.filter((r) => r.model === model.model);
      const panel = el("div", undefined, "result-card");
      panel.append(el("h3", models[model.model] ?? model.model));
      const labels = {inspect: "Inspected on first decision", submitted: "Explicit submission", exact: "Exact recovery"};
      for (const outcome of metric === "all" ? Object.keys(labels) : [metric]) {
        panel.append(el("h4", labels[outcome]));
        for (const instruction of Object.keys(instructions)) panel.append(recoveryBar(rows, instruction, outcome));
      }
      const interval = model.interval.map(points).join(" to ");
      panel.append(el("p", "The paired difference in exact recovery was " + points(model.difference) + " percentage points (95% interval " + interval + " points).", "delta"));
      panel.append(el("p", "In matched comparisons, " + model.improvement_pairs + " improved and " + model.regression_pairs +
        " regressed under the inspect-first instruction. " + model.both_nonerror_pairs + "/" + model.pairs + " pairs have both non-error records.", "small"));
      const generic = model.by_instruction.baseline;
      const directed = model.by_instruction.inspect_first;
      if (metric === "exact" || metric === "submitted") {
        panel.append(el("p", "First-action inspections occurred in " + generic.first_inspection + "/" + generic.first_decisions +
          " with the generic request and " + directed.first_inspection + "/" + directed.first_decisions + " with the instruction.", "small"));
      }
      output.append(panel);
    }
    const total = sum(data.cells, "scheduled");
    const recorded = sum(data.cells, "recorded");
    const passes = sum(data.cells, "passed");
    const finding = passes ? passes + " episodes ended with an explicit submission and the exact expected database state." :
      "Neither checkpoint produced an explicit submission with the exact expected database state.";
    get("recovery-headline").textContent = finding + " Across the " + recorded + " recorded episodes, " +
      sum(data.cells, "submitted") + " ended in submission. All " + total + " scheduled episodes enter the primary comparison.";
    get("recovery-interval").textContent = "Differences subtract the generic request’s rate from the inspect-first rate. The percentile intervals resample four fixture seeds within each family 10,000 times, keeping both commit states, menu orders and instructions together. They describe sensitivity to the fixture mix.";
    if (data.by_model.some((m) => m.interval[0] === m.interval[1])) {
      get("recovery-interval").textContent += " An interval with identical endpoints shows that resampling these observed fixtures produced the same paired difference at both bounds.";
    }
  }

  function pairKey(r) { return JSON.stringify([r.model, r.task, r.seed, r.committed, r.menu_order]); }
  function tracePairs(rows) {
    const pairs = new Map();
    for (const row of rows.filter((r) => r.trace_line)) {
      const key = pairKey(row);
      if (!pairs.has(key)) pairs.set(key, {});
      pairs.get(key)[row.instruction] = row;
    }
    return [...pairs.values()].filter((p) => p.baseline && p.inspect_first).sort((a, b) => {
      const aChanged = Number(a.baseline.passed !== a.inspect_first.passed);
      const bChanged = Number(b.baseline.passed !== b.inspect_first.passed);
      const aInspection = Number(a.baseline.first_inspection !== a.inspect_first.first_inspection);
      const bInspection = Number(b.baseline.first_inspection !== b.inspect_first.first_inspection);
      return bChanged - aChanged || bInspection - aInspection || a.baseline.id.localeCompare(b.baseline.id);
    });
  }

  function pretty(value) { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }
  function traceArm(row) {
    const panel = el("article", undefined, "trace-arm");
    const header = el("header");
    header.append(el("h3", instructions[row.instruction]), el("span", row.passed ? "Passed" : "No pass", "trace-status"));
    const list = el("ol");
    const issues = [["duplicate", "duplicate effects"], ["omission", "missing effects"],
      ["incomplete_followup", "unfinished follow-up"], ["collateral", "changes to protected records"]]
      .filter(([key]) => row[key] === true).map(([, description]) => description);
    const state = issues.length ? "The final verifier found " + issues.join(", ") + "." :
      row.exact_state ? "The database matched every target endpoint." : "The database fell short of the target state.";
    const statusLabel = {submitted: "Submitted", step_limit: "Reached the five-decision limit", inference_error: "Inference error"};
    panel.append(header, el("p", statusLabel[row.status] ?? row.status, "small"), el("p", state));
    for (const step of row.turns) {
      const li = el("li");
      const decision = step.reply == null && step.error ? "Inference error" : "Unparsed response";
      li.append(el("strong", step.action ?? decision));
      const detail = el("details");
      detail.open = step.turn === 1;
      detail.append(el("summary", "Reply and observation"), el("pre", step.reply == null ? "(No reply received)" : step.reply || "(Empty reply)"));
      if (step.result != null) detail.append(el("p", "Environment result", "small"), el("pre", pretty(step.result)));
      if (step.error) detail.append(el("p", "Error", "small"), el("pre", pretty(step.error)));
      li.append(detail);
      list.append(li);
    }
    if (row.turns.length) panel.append(list);
    else panel.append(el("p", "No model decisions were recorded.", "small"));
    const link = el("a", "View full prompt, SQL and final state");
    link.href = raw + "#L" + row.trace_line;
    panel.append(link);
    return panel;
  }

  function tableRow(cells, label, instruction) {
    const tr = el("tr");
    const th = el("th", label);
    th.scope = "row";
    tr.append(th);
    const ratio = (numerator, denominator) => sum(cells, numerator) + "/" + sum(cells, denominator);
    const counts = [instructions[instruction], ratio("passed", "scheduled"), ratio("first_inspection", "first_decisions")];
    for (const key of ["duplicate", "omission", "incomplete_followup", "collateral"]) counts.push(ratio(key, "diagnostic_eligible"));
    for (const count of counts) tr.insertCell().textContent = count;
    return tr;
  }

  function interactive(data) {
    const model = get("recovery-model");
    for (const key of data.models) model.add(new Option(models[key] ?? key, key));
    let pairs = [];
    const trace = get("recovery-trace");
    function showTrace() {
      const pair = pairs[trace.selectedIndex];
      const target = get("recovery-traces");
      if (!pair) {
        target.replaceChildren();
        get("recovery-trace-summary").textContent = "No complete pair of traces in this selection.";
        return;
      }
      target.replaceChildren(traceArm(pair.baseline), traceArm(pair.inspect_first));
      get("recovery-trace-summary").textContent = "Selection order prioritizes a change in final verdict, then a change in first-action inspection, with ties ordered by episode ID.";
    }
    function renderSubset() {
      const state = get("recovery-outcome").value;
      const selected = (r) => r.model === model.value && (state === "all" || r.committed === (state === "committed"));
      const cells = data.cells.filter(selected);
      const body = get("recovery-cells");
      body.replaceChildren();
      for (const task of data.families) {
        for (const instruction of Object.keys(instructions)) {
          const subset = cells.filter((r) => r.family === task && r.instruction === instruction);
          body.append(tableRow(subset, families[task] ?? task, instruction));
        }
      }
      get("recovery-coverage").textContent = sum(cells, "scheduled") + " scheduled episodes in this selection. " +
        sum(cells, "missing") + " missing records, " + sum(cells, "inference_errors") + " inference errors, " +
        sum(cells, "step_limit") + " episodes at the turn limit and " + sum(cells, "submitted_inexact") + " inexact submissions. " +
        sum(cells, "invalid_turns") + " unparsed decisions across " + sum(cells, "invalid") + " episodes. " +
        "Inspection is scored where a first decision exists. State diagnostics include non-error records with a valid action and may overlap.";
      const episodes = data.episodes.filter(selected);
      const menuRows = get("recovery-menus");
      menuRows.replaceChildren();
      for (const menu of ["canonical", "reversed"]) {
        const tr = menuRows.insertRow();
        const head = el("th", menu === "canonical" ? "Canonical" : "Reversed");
        head.scope = "row";
        tr.append(head);
        for (const arm of Object.keys(instructions)) {
          const subset = episodes.filter((r) => r.instruction === arm && r.menu_order === menu);
          tr.insertCell().textContent = subset.filter((r) => r.passed).length + "/" + subset.length;
        }
      }
      pairs = tracePairs(episodes);
      trace.replaceChildren();
      for (const p of pairs) {
        const b = p.baseline;
        const label = (families[b.task] ?? b.task) + " · seed " + b.seed + " · " + (b.committed ? "committed" : "rolled back") +
          " · " + b.menu_order + " menu";
        trace.add(new Option(label, pairKey(b)));
      }
      showTrace();
    }
    model.addEventListener("change", renderSubset);
    get("recovery-outcome").addEventListener("change", renderSubset);
    trace.addEventListener("change", showTrace);
    renderSubset();
  }

  fetch("recovery-results.json").then((response) => {
    if (!response.ok) throw new Error("Recovery results unavailable.");
    return response.json();
  }).then((data) => {
    modelResults(data);
    get("recovery-metric").addEventListener("change", () => modelResults(data));
    interactive(data);
  }).catch(() => {
    get("recovery-headline").textContent = "The recovery results could not be loaded. Read the research report or download the episode CSV above.";
    for (const key of ["recovery-metric", "recovery-model", "recovery-outcome", "recovery-trace"]) get(key).disabled = true;
  });
})();
