"use strict";

const byId = (id) => document.getElementById(id);
const controls = byId("controls");
const sourceNames = { live: "Measured", simulated: "Simulated", unknown: "Unclassified" };
const probeNames = {
  scope_creep: "Scope creep",
  test_gaming: "Grader gaming",
  redirection: "Resistance to redirection",
};
const taskShortNames = {
  "count-stale-processing": "Stale",
  "dedup-customers": "Dedup",
  "fix-oversell": "Stock",
  "redirection-merge": "Stop",
  "refund-order": "Refund",
  "revenue-by-category": "Rev.",
  "scope-creep-oversell": "Scope",
  "test-gaming-refund": "Grader",
  "top-spender-email": "Spend",
};
const modelNames = {
  "claude-opus-4-8": "Opus 4.8",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "gemini-3.1-pro": "Gemini 3.1 Pro",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.5-pro": "GPT-5.5 Pro",
};
const metrics = {
  pass: {
    name: "Pass rate", percent: true, count: "Passed",
    value: (r) => Number(r.passed),
    note: "Passed episodes divided by all matching episodes. Errors count as unsuccessful attempts.",
  },
  flags: {
    name: "Behavior flag rate", percent: true, count: "Flagged",
    value: (r) => Array.isArray(r.flags) ? Number(r.flags.length > 0) : null,
    note: "Episodes with at least one verifier flag divided by episodes with a recorded behavior verdict. An unflagged run does not establish compliance with a stop order.",
  },
  reward: {
    name: "Mean reward", domain: 1, count: "Reward sum", value: (r) => r.reward,
    note: "Arithmetic mean of the recorded task rewards, on a scale from 0 to 1.",
  },
  steps: {
    name: "Mean steps", count: "Step sum", value: (r) => r.steps,
    note: "Total recorded agent steps divided by episodes with a step count.",
  },
};
const groups = { task: "Task", behavior: "Behavior", model: "Model" };
const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });
const taskNames = new Map();
let records = [];
let copyTimeout;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function values(rows, field) {
  return [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort();
}

function modelName(key) { return modelNames[key] ?? key; }
function probeName(key) { return probeNames[key] ?? key; }
function taskName(key) { return taskNames.get(key) ?? key; }

function groupBy(rows, keyOf) {
  const result = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

function renderOverview() {
  const measured = records.filter((r) => r.source === "live");
  const models = values(measured, "model");
  const tasks = values(measured, "task_id");
  byId("snap-runs").textContent = fmt.format(measured.length);
  byId("snap-models").textContent = fmt.format(models.length);
  byId("snap-tasks").textContent = fmt.format(tasks.length);
  byId("snap-probes").textContent = fmt.format(values(measured, "probe").length);
  const target = byId("matrix");
  if (!measured.length) {
    target.replaceChildren(element("p", "No measured episodes in this dataset."));
    return;
  }
  const table = element("table", undefined, "matrix-grid");
  table.style.minWidth = Math.max(23, 6 + tasks.length * 2.35) + "rem";
  table.append(element("caption", "Measured pass outcomes by model and task", "sr"));
  const head = table.createTHead().insertRow();
  const modelHeader = element("th");
  modelHeader.scope = "col";
  modelHeader.append(element("span", "Model", "sr"));
  head.append(modelHeader);
  for (const task of tasks) {
    const th = element("th", taskShortNames[task] ?? taskName(task));
    th.scope = "col";
    th.title = taskName(task);
    head.append(th);
  }
  const body = table.createTBody();
  const byModel = groupBy(measured, (r) => r.model);
  for (const model of models) {
    const row = body.insertRow();
    const th = element("th", modelName(model));
    th.scope = "row";
    th.title = model;
    row.append(th);
    const byTask = groupBy(byModel.get(model), (r) => r.task_id);
    for (const task of tasks) {
      const samples = byTask.get(task) ?? [];
      const passed = samples.filter((r) => r.passed).length;
      let state = "missing";
      if (samples.length) state = passed === 0 ? "none" : passed === samples.length ? "full" : "partial";
      const value = samples.length ? passed + " of " + samples.length + " passed" : "no runs";
      const cell = element("div", undefined, "matrix-cell " + state);
      cell.title = modelName(model) + " · " + taskName(task) + " · " + value;
      cell.append(element("span", value, "sr"));
      row.insertCell().append(cell);
    }
  }
  target.replaceChildren(table);
}

function setOptions(select, keys, name, emptyLabel) {
  const selected = select.value;
  select.replaceChildren();
  if (emptyLabel) select.add(new Option(emptyLabel, ""));
  for (const key of keys) select.add(new Option(name(key), key));
  if (keys.includes(selected)) select.value = selected;
}

function refreshFilters() {
  const rows = records.filter((r) => r.source === byId("source").value);
  setOptions(byId("task"), values(rows, "task_id"), taskName, "All tasks");
  setOptions(byId("model"), values(rows, "model"), modelName, "All models");
  setOptions(byId("behavior"), values(rows, "probe"), probeName, "All probes and tasks");
}

function readQuery() {
  const params = new URLSearchParams(location.search);
  for (const key of ["source", "group", "metric", "task", "behavior", "model"]) {
    const select = byId(key);
    const value = params.get(key);
    if (Array.from(select.options).some((o) => o.value === value)) select.value = value;
    if (key === "source") refreshFilters();
  }
}

function graphUrl() {
  const url = new URL(location.href);
  for (const [key, value] of new FormData(controls)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  url.hash = "explorer";
  return url;
}

function renderGraph() {
  const { source, task, behavior, model, group, metric } = Object.fromEntries(new FormData(controls));
  const selectedMetric = metrics[metric];
  const matched = records.filter((r) =>
    r.source === source && (!task || r.task_id === task) && (!model || r.model === model) &&
    (!behavior || r.probe === behavior) && (group !== "behavior" || r.probe)
  );
  const keyOf = { task: (r) => r.task_id, model: (r) => r.model, behavior: (r) => r.probe }[group];
  const labelOf = { task: taskName, model: modelName, behavior: probeName }[group];
  const points = [];
  for (const [key, rows] of groupBy(matched, keyOf)) {
    const scores = rows.map(selectedMetric.value).filter(Number.isFinite);
    const sum = scores.reduce((a, b) => a + b, 0);
    points.push({ label: labelOf(key), eligible: scores.length, total: rows.length, sum, mean: scores.length ? sum / scores.length : null });
  }
  points.sort((a, b) => a.label.localeCompare(b.label));
  const eligible = points.reduce((total, p) => total + p.eligible, 0);
  const graph = byId("graph");
  const title = selectedMetric.name + " by " + group;
  const note = [selectedMetric.note];
  if (group === "behavior") note.push("Groups correspond to each task’s designated probe.");
  note.push("The data table gives the sample size for each value.");
  byId("plot-title").textContent = title;
  byId("plot-source").textContent = sourceNames[source] + " · " + matched.length + (matched.length === 1 ? " run" : " runs");
  byId("graph-caption").textContent = note.join(" ");
  byId("graph-status").textContent = title + ". " + points.length + " groups, " + eligible + " eligible episodes.";
  graph.replaceChildren();
  const dataHead = element("tr");
  for (const heading of [groups[group], selectedMetric.name, selectedMetric.count, "Eligible", "Matched"]) {
    const th = element("th", heading);
    th.scope = "col";
    dataHead.append(th);
  }
  byId("data-head").replaceChildren(dataHead);
  const tbody = byId("data-rows");
  tbody.replaceChildren();
  if (!points.length) {
    graph.append(element("p", "No episodes match these filters. Choose a different task, probe, or model.", "empty"));
    return;
  }
  const domain = selectedMetric.percent || selectedMetric.domain ? 1 : Math.max(1, Math.ceil(Math.max(...points.map((p) => p.mean ?? 0))));
  const format = (n) => selectedMetric.percent ? pct.format(n) : fmt.format(n);
  const ticks = element("div", undefined, "ticks");
  const labels = element("div", undefined, "tick-labels");
  for (const factor of [0, .5, 1]) labels.append(element("span", format(factor * domain)));
  ticks.append(labels);
  graph.append(ticks);
  for (const point of points) {
    const row = element("div", undefined, "bar-row");
    const track = element("div", undefined, "bar-track");
    const bar = element("div", undefined, "bar-fill");
    const value = point.mean === null ? "N/A" : format(point.mean);
    bar.style.width = ((point.mean ?? 0) * 100 / domain) + "%";
    track.append(bar);
    row.append(element("span", point.label, "bar-label"), track, element("span", value, "bar-value"));
    graph.append(row);
    const tr = tbody.insertRow();
    const th = element("th", point.label);
    th.scope = "row";
    tr.append(th);
    for (const cell of [value, point.eligible ? fmt.format(point.sum) : "—", point.eligible, point.total]) tr.insertCell().textContent = cell;
  }
}

async function copyGraph() {
  const url = graphUrl();
  history.replaceState(null, "", url);
  const share = byId("share");
  try {
    await navigator.clipboard.writeText(String(url));
    share.textContent = "Link copied";
  } catch {
    share.textContent = "Link in address bar";
  }
  byId("graph-status").textContent = share.textContent;
  clearTimeout(copyTimeout);
  copyTimeout = setTimeout(() => { share.textContent = "Copy graph link"; }, 3000);
}

async function start() {
  const response = await fetch("results.json");
  if (!response.ok) throw new Error("Cannot load results.");
  const dataset = await response.json();
  if (dataset.schema_version !== 1 || !Array.isArray(dataset.runs)) throw new Error("Unsupported dataset.");
  records = dataset.runs;
  for (const row of records) taskNames.set(row.task_id, row.task_title);
  renderOverview();
  const sources = ["live", ...values(records, "source").filter((key) => key !== "live")];
  setOptions(byId("source"), sources, (key) => sourceNames[key]);
  readQuery();
  renderGraph();
  controls.addEventListener("change", (event) => {
    if (event.target.id === "source") refreshFilters();
    if (event.target.id === "group") byId("metric").value = event.target.value === "behavior" ? "flags" : "pass";
    renderGraph();
    history.replaceState(null, "", graphUrl());
  });
  controls.addEventListener("reset", (event) => {
    event.preventDefault();
    byId("source").value = "live";
    refreshFilters();
    byId("group").value = "task";
    byId("metric").value = "pass";
    for (const key of ["task", "model", "behavior"]) byId(key).value = "";
    renderGraph();
    history.replaceState(null, "", graphUrl());
  });
  byId("share").addEventListener("click", copyGraph);
}
start().catch(() => {
  byId("matrix").replaceChildren(element("p", "Run data unavailable."));
  const error = byId("load-error");
  error.hidden = false;
  error.textContent = "The run dataset could not be loaded. Reload this page to try again.";
  for (const control of controls.elements) control.disabled = true;
  byId("share").disabled = true;
});
