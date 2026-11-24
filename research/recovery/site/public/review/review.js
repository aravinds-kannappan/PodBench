"use strict";
const $ = id => document.getElementById(id);
const node = (name, value) => {
  const element = document.createElement(name);
  if (value !== undefined) element.textContent = String(value);
  return element;
};
let kit, annotator, ratings = {}, current = 0;
const key = () => "podbench-review/" + kit.kit_id + "/" + annotator;
const display = text => String(text).replaceAll("\u2014", "\\u2014");
const dump = obj => display(JSON.stringify(obj, null, 2));
function localNotice(message) { $("saved").textContent = message; }
function persist() {
  try {
    localStorage.setItem(key(), JSON.stringify(ratings));
    localNotice("Saved in this browser.");
  } catch {
    localNotice("Browser storage unavailable. Export your ratings before leaving.");
  }
}
function options(select, values) {
  values.forEach(([value, text]) => {
    const option = node("option", text);
    option.value = value;
    select.append(option);
  });
}
function addRubric() {
  Object.entries(kit.rubric).forEach(([id, item]) => {
    $("rubric").append(node("h3", item.title), node("p", item.guide));
    const label = node("label", item.title);
    label.htmlFor = "rate-" + id;
    const field = node("select");
    field.id = label.htmlFor;
    field.dataset.question = id;
    const help = node("p", item.guide);
    help.className = "help";
    help.id = "guide-" + id;
    field.setAttribute("aria-describedby", help.id);
    options(field, [["", "Unanswered"], ...item.choices.map(c => [c, c])]);
    $("questions").append(label, help, field);
  });
}
function detail(title, content) {
  const details = node("details");
  details.append(node("summary", title), node("pre", content));
  return details;
}
function showCase() {
  const item = kit.cases[current];
  $("case").selectedIndex = current;
  $("previous").disabled = current === 0;
  $("next").disabled = current === kit.cases.length - 1;
  const evidence = $("evidence");
  evidence.replaceChildren(node("h3", "Work order and handoff"), node("pre", display(item.work_order_and_handoff)));
  const menu = node("dl");
  item.menu.forEach(m => menu.append(node("dt", m.name), node("dd", m.description)));
  evidence.append(node("h3", "Displayed menu"), menu);
  for (const turn of item.turns) {
    const div = node("div");
    div.className = "turn";
    div.append(node("h3", "Decision " + turn.turn), node("pre", display(turn.reply)));
    if (turn.tool_observation) {
      div.append(node("p", "Executed " + turn.parsed_action + "."), node("pre", dump(turn.tool_observation)));
    } else {
      div.append(node("p", "Invalid action. No statement executed."));
    }
    div.append(detail("Database difference from target after this decision", dump(turn.db_diff_after)));
    evidence.append(div);
  }
  evidence.append(node("h3", "End of episode"), node("p", item.terminal_status.replaceAll("_", " ")),
    node("p", "Missing rows are required by the target. Extra rows are present only in the recorded database. An empty object means all rows match."),
    node("pre", dump(item.final_db_diff)), detail("Column order for row tuples", dump(item.table_columns)));
  const row = ratings[item.case_id] || {};
  document.querySelectorAll("[data-question]").forEach(el => { el.value = row[el.dataset.question] || ""; });
  $("notes").value = row.notes || "";
  localNotice("Showing " + item.case_id + ". Literal punctuation in replies may appear as Unicode escapes.");
}
function onResponse(event) {
  const item = kit.cases[current];
  const q = event.target.dataset.question || (event.target.id === "notes" ? "notes" : null);
  if (!q) return;
  ratings[item.case_id] ||= {};
  if (event.target.value) ratings[item.case_id][q] = event.target.value;
  else delete ratings[item.case_id][q];
  if (!Object.keys(ratings[item.case_id]).length) delete ratings[item.case_id];
  persist();
}
function table(root, headings, rows) {
  const wrap = node("div"); wrap.className = "scroll";
  const t = node("table"), header = node("tr");
  headings.forEach(h => { const th = node("th", h); th.scope = "col"; header.append(th); });
  t.append(header);
  rows.forEach(cells => {
    const tr = node("tr"); cells.forEach(cell => tr.append(node("td", cell))); t.append(tr);
  });
  wrap.append(t); root.append(wrap);
}
function showReport(report) {
  let root = $("report");
  if (report.kit_id !== kit.kit_id) throw new Error("Agreement report and annotation kit differ.");
  root.replaceChildren(node("p", report.status));
  if (report.status === "awaiting annotations") {
    root.append(node("p", "The kit is ready. Agreement and disagreements will appear after researchers supply real ratings."));
    return;
  }
  const postReview = node("details");
  postReview.append(node("summary", "View results after locking your ratings (reveals automated labels)"));
  root.append(postReview);
  root = postReview;
  const kappa = score => score.kappa === null ? score.status : score.kappa.toFixed(3);
  root.append(node("p", "Unweighted agreement. Pairwise comparisons use jointly rated cases. Fleiss uses cases rated by the full panel."));
  const agreement = [];
  for (const [id, s] of Object.entries(report.rubric)) {
    s.pairwise_cohen.forEach(c => agreement.push([kit.rubric[id].title, c.readers.join(" / "), c.n, kappa(c)]));
    agreement.push([kit.rubric[id].title, "Fleiss, complete panel", s.fleiss_complete_panel.n, kappa(s.fleiss_complete_panel)]);
  }
  table(root, ["Rubric", "Comparison", "Cases", "Kappa"], agreement);
  root.append(node("h3", "Expert and automated failure labels"));
  table(root, ["Reader", "Rated cases", "Cohen kappa"], report.expert_vs_automated.map(c => [c.reader, c.n, kappa(c)]));
  const labels = Array.from(new Set(report.confusion.flatMap(c => [c.expert, c.automated]))).sort();
  const counts = new Map(report.confusion.map(c => [JSON.stringify([c.expert, c.automated]), c.count]));
  if (labels.length) {
    table(root, ["Expert / automated", ...labels], labels.map(x => [x,
      ...labels.map(y => counts.get(JSON.stringify([x, y])) || 0)]));
  } else root.append(node("p", "No expert failure labels supplied."));
  root.append(node("h3", "Disagreements"));
  if (report.disagreements.length) table(root, ["Case", "Reader", "Expert", "Automated"],
    report.disagreements.map(d => [d.case_id, d.reader, d.expert, d.automated]));
  else root.append(node("p", "No disagreement recorded among compared labels."));
}

$("start").addEventListener("submit", event => {
  event.preventDefault();
  annotator = $("reader").value.trim();
  if (!annotator) { $("notice").textContent = "Enter a pseudonym."; return; }
  try { ratings = JSON.parse(localStorage.getItem(key()) || "{}"); }
  catch { ratings = {}; $("notice").textContent = "Stored session unavailable. Export a copy of new ratings."; }
  $("workspace").hidden = false;
  $("notice").textContent = "Active local session for " + annotator + ".";
  current = 0; showCase();
});
$("previous").addEventListener("click", () => { if (current > 0) current--; showCase(); });
$("next").addEventListener("click", () => { if (current + 1 < kit.cases.length) current++; showCase(); });
$("case").addEventListener("change", event => { current = event.target.selectedIndex; showCase(); });
$("ratings").addEventListener("input", onResponse);
$("ratings").addEventListener("submit", event => event.preventDefault());
$("export").addEventListener("click", () => {
  const snapshot = {schema_version: 1, kit_id: kit.kit_id, annotator_id: annotator, ratings};
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], {type:"application/json"}));
  const a = node("a"); a.href = url;
  a.download = "podbench-ratings-" + annotator.replace(/[^A-Za-z0-9_-]/g, "_") + ".json";
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function load() {
  const read = async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error("Could not load " + path);
    return response.json();
  };
  kit = await read("kit.json");
  addRubric();
  options($("case"), kit.cases.map(c => [c.case_id, c.case_id]));
  $("open").disabled = false;
  $("notice").textContent = "Ready. Open a local session to begin.";
  showReport(await read("agreement.json"));
}
load().catch(error => { $("notice").textContent = error.message; $("report").textContent = "Status could not be loaded."; });
