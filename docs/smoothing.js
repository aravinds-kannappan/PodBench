"use strict";

const smoothTasks = {
  scope_creep: "Read-only scope", redirection: "Operator hold", test_gaming: "Refund integrity",
};

function smoothNode(tag, text, style) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style) node.className = style;
  return node;
}

function smoothBar(label, correct, total) {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.append(smoothNode("strong", label), smoothNode("span", correct + "/" + total));
  const track = smoothNode("div", undefined, "study-track");
  const fill = document.createElement("i");
  fill.style.width = (100 * correct / total) + "%";
  track.setAttribute("aria-hidden", "true");
  track.append(fill);
  figure.append(caption, track);
  return figure;
}

function showSmoothStudy(study) {
  const id = (suffix) => document.getElementById("smooth-" + suffix);
  const s = study.summary;
  id("status").textContent = "The model selected the authorized action in " + s.clean_correct + "/" +
    s.presentations + " original presentations. The five-way vote selected it in " + s.voted_correct +
    "/" + s.presentations + ". Voting recovered " + s.gained + " original misses and lost " + s.lost + " original passes.";
  for (const [task, cell] of Object.entries(study.by_task)) {
    const group = smoothNode("section", undefined, "study-group");
    group.append(smoothNode("h4", smoothTasks[task]), smoothBar("Original", cell.clean_correct, cell.presentations),
      smoothBar("Majority vote", cell.voted_correct, cell.presentations));
    id("chart").append(group);
  }
  id("flips").textContent = "On " + s.perturbed_label_changes + " of " + s.valid_comparisons +
    " draws where both answers parsed, the typo changed the selected letter. Invalid replies accounted for " +
    s.invalid_draw + "/" + s.perturbed_completions + " perturbed completions and " + s.invalid_clean + "/" +
    s.presentations + " clean completions. " + s.no_majority + " presentations ended without a majority.";
  id("orders").textContent = "Across the " + s.cases + " distinct work orders, the original response was correct in both option orders on " +
    s.clean_correct_in_both_orders + ". Voting was correct in both orders on " + s.voted_correct_in_both_orders + ".";
  const records = [...study.trials].sort((a, b) => a.case_id.localeCompare(b.case_id) || a.order.localeCompare(b.order));
  const select = id("case");
  for (const [index, row] of records.entries()) {
    select.add(new Option(row.case_id + " · correct option " + row.correct_choice, String(index)));
  }
  function trace() {
    const row = records[Number(select.value)];
    const container = id("trace");
    container.replaceChildren(smoothNode("pre", row.prompt),
      smoothNode("p", "Expected " + row.correct_choice + ". Original reply " + JSON.stringify(row.clean.response) +
        ". Majority choice " + (row.voted_choice ?? "undecided") + "."));
    const table = document.createElement("table");
    table.append(smoothNode("caption", "All five recorded draws"));
    const head = table.createTHead().insertRow();
    for (const label of ["Draw", "Original word → typo", "Raw reply", "Parsed vote"]) {
      const cell = smoothNode("th", label);
      cell.scope = "col";
      head.append(cell);
    }
    const body = table.createTBody();
    for (const [index, draw] of row.draws.entries()) {
      const before = row.prompt.slice(0, draw.swap_offset).match(/[A-Za-z]*$/)[0].length;
      const after = row.prompt.slice(draw.swap_offset).match(/^[A-Za-z]*/)[0].length;
      const start = draw.swap_offset - before;
      const end = draw.swap_offset + after;
      const tr = body.insertRow();
      for (const value of [index + 1, row.prompt.slice(start, end) + " → " + draw.prompt.slice(start, end),
        JSON.stringify(draw.response), draw.choice ?? "Invalid"]) {
        tr.insertCell().textContent = value;
      }
    }
    container.append(table);
  }
  select.addEventListener("change", trace);
  const notable = records.findIndex((r) => r.clean.choice !== r.voted_choice || r.draws.some((d) => d.choice === null));
  if (notable !== -1) select.value = String(notable);
  trace();
  id("results").hidden = false;
}

fetch("smoothing-results.json").then((response) => {
  if (!response.ok) throw new Error("Could not load the recorded results.");
  return response.json();
}).then(showSmoothStudy).catch(() => {
  document.getElementById("smooth-status").textContent = "The results could not be displayed. The full record is available below.";
});
