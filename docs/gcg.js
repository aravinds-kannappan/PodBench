"use strict";

function checkKeys(value, expected, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(location + " must be a JSON object.");
  }
  for (const field of expected) {
    if (!Object.hasOwn(value, field)) throw new Error(location + " is missing " + field + ".");
  }
  if (Object.keys(value).some((field) => !expected.includes(field))) {
    throw new Error(location + " includes extra fields. Use the fields in the JSON format.");
  }
}

function checkText(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) {
    throw new Error(name + " must contain 1–2,000 characters.");
  }
}

function parseReport(raw) {
  let report;
  try {
    report = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The file contains invalid JSON.");
  }
  const metadataFields = ["source", "model", "evaluator", "rubric"];
  checkKeys(report, ["method", ...metadataFields, "cases"], "The report");
  if (report.method !== "GCG") throw new Error('The method field must be "GCG".');
  for (const field of metadataFields) checkText(report[field], field);
  if (!Array.isArray(report.cases) || !report.cases.length) {
    throw new Error("Include at least one matched case in cases.");
  }
  const ids = new Set();
  for (const [index, pair] of report.cases.entries()) {
    const label = "Case " + (index + 1);
    checkKeys(pair, ["id", "task", "behavior", "clean", "gcg"], label);
    for (const field of ["id", "task", "behavior"]) {
      checkText(pair[field], label + " " + field);
      pair[field] = pair[field].trim();
    }
    if (ids.has(pair.id)) throw new Error(label + " repeats an earlier pair ID.");
    ids.add(pair.id);
    for (const condition of ["clean", "gcg"]) {
      const result = pair[condition];
      checkKeys(result, ["taskPassed", "behaviorMaintained"], label + " " + condition);
      for (const value of Object.values(result)) {
        if (value !== null && typeof value !== "boolean") {
          throw new Error(label + " verdicts must be true, false or null.");
        }
      }
    }
  }
  return report;
}

function summarizePairs(cases, groupBy, metric) {
  const groups = new Map();
  for (const pair of cases) {
    const name = pair[groupBy];
    if (!groups.has(name)) {
      groups.set(name, { name, total: 0, scored: 0, clean: 0, gcg: 0, lost: 0, gained: 0 });
    }
    const group = groups.get(name);
    group.total++;
    const clean = pair.clean[metric];
    const gcg = pair.gcg[metric];
    if (clean === null || gcg === null) continue;
    group.scored++;
    if (clean) group.clean++;
    if (gcg) group.gcg++;
    if (clean && !gcg) group.lost++;
    if (!clean && gcg) group.gained++;
  }
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function setupImporter() {
  const element = (id) => document.getElementById("gcg-" + id);
  const make = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const pageSize = 20;
  let report;
  let firstGroup = 0;
  let readNumber = 0;

  function bar(label, count, scored) {
    const rate = 100 * count / scored;
    const row = document.createElement("div");
    row.className = "gcg-bar";
    const track = document.createElement("span");
    track.className = "gcg-track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = label === "GCG" ? "gcg-fill gcg-variant" : "gcg-fill";
    fill.style.width = rate + "%";
    track.append(fill);
    row.append(make("span", label), track, make("span", percent.format(rate) + "% (" + count + "/" + scored + ")"));
    return row;
  }

  function render() {
    const groups = summarizePairs(report.cases, element("group").value, element("metric").value);
    const lastGroup = Math.min(firstGroup + pageSize, groups.length);
    const entries = document.createDocumentFragment();
    for (const group of groups.slice(firstGroup, lastGroup)) {
      const item = document.createElement("section");
      item.className = "gcg-group";
      item.append(make("h3", group.name));
      if (group.scored) {
        item.append(bar("Clean", group.clean, group.scored), bar("GCG", group.gcg, group.scored));
        item.append(make("p", group.lost + " changed from pass to fail · " + group.gained + " changed from fail to pass."));
      } else {
        item.append(make("p", "No pairs scored in both conditions."));
      }
      item.append(make("p", group.scored + " of " + group.total + " matched pairs scored in both conditions."));
      entries.append(item);
    }
    element("chart").replaceChildren(entries);
    element("pages").hidden = groups.length <= pageSize;
    element("range").textContent = (firstGroup + 1) + "–" + lastGroup + " of " + groups.length;
    element("prev").disabled = firstGroup === 0;
    element("next").disabled = lastGroup === groups.length;
  }

  element("file").addEventListener("change", async (event) => {
    const request = ++readNumber;
    const file = event.target.files[0];
    const status = element("status");
    element("results").hidden = true;
    report = null;
    delete status.dataset.error;
    if (!file) {
      status.textContent = "Choose a file to graph your results.";
      return;
    }
    status.textContent = "Reading evaluation…";
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Choose a JSON file of 10 MiB or less.");
      const raw = await file.text();
      if (request !== readNumber) return;
      report = parseReport(raw);
      const metadata = document.createDocumentFragment();
      for (const [key, label] of Object.entries({ source: "Source", model: "Model", evaluator: "Evaluator", rubric: "Scoring rubric" })) {
        metadata.append(make("dt", label), make("dd", report[key]));
      }
      element("metadata").replaceChildren(metadata);
      firstGroup = 0;
      render();
      element("results").hidden = false;
      status.textContent = "Loaded " + report.cases.length + (report.cases.length === 1 ? " matched case." : " matched cases.");
    } catch (error) {
      if (request !== readNumber) return;
      status.dataset.error = "";
      status.textContent = error.message;
    }
  });
  for (const name of ["group", "metric"]) {
    element(name).addEventListener("change", () => {
      firstGroup = 0;
      render();
    });
  }
  element("prev").addEventListener("click", () => {
    firstGroup -= pageSize;
    render();
  });
  element("next").addEventListener("click", () => {
    firstGroup += pageSize;
    render();
  });
}
setupImporter();
