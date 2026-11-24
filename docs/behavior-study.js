// Render the published generation records. Only responses with a scored A/B
// choice enter the accuracy denominator. The trial inspector keeps both arms.
(() => {
  "use strict";
  const id = (key) => document.getElementById(key);
  const percent = new Intl.NumberFormat("en", {style: "percent", maximumFractionDigits: 1});

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function verdict(trial) {
    if (trial.correct === true) return "Correct";
    if (trial.correct === false) return "Wrong";
    return "Invalid";
  }

  function chartRow(rows, condition, treatment) {
    const eligible = rows.filter((r) => typeof r.correct === "boolean").length;
    const correct = rows.filter((r) => r.correct === true).length;
    const rate = eligible ? percent.format(correct / eligible) : "N/A";
    const figure = el("figure");
    const caption = el("figcaption");
    caption.append(el("strong", condition.label), el("span", rate));
    const track = el("div", undefined, treatment ? "study-track study-treatment" : "study-track");
    track.setAttribute("aria-hidden", "true");
    const fill = el("i");
    fill.style.width = eligible ? correct * 100 / eligible + "%" : "0";
    track.append(fill);
    const count = correct + "/" + eligible + " correct · " + (eligible - correct) + " wrong · " + (rows.length - eligible) + " invalid";
    figure.append(caption, track, el("p", count, "study-counts"));
    return figure;
  }

  function orderCounts(rows) {
    const cases = new Map();
    for (const trial of rows) {
      const key = JSON.stringify([trial.task, trial.case_id]);
      if (!cases.has(key)) cases.set(key, {});
      cases.get(key)[trial.order] = trial;
    }
    const valid = [...cases.values()].filter(({AB, BA}) =>
      typeof AB?.correct === "boolean" && typeof BA?.correct === "boolean"
    );
    return {
      total: cases.size,
      valid: valid.length,
      flipped: valid.filter(({AB, BA}) => AB.correct !== BA.correct).length,
      bothCorrect: valid.filter(({AB, BA}) => AB.correct && BA.correct).length,
      choseA: rows.filter((r) => r.choice === "A").length,
      choseB: rows.filter((r) => r.choice === "B").length,
    };
  }

  function renderOrderRow(rows, label) {
    const {total, valid, flipped, bothCorrect, choseA, choseB} = orderCounts(rows);
    const tr = el("tr");
    const th = el("th", label);
    th.scope = "row";
    tr.append(th);
    for (const value of [flipped + "/" + valid, bothCorrect + "/" + valid, total - valid, choseA + " / " + choseB]) {
      tr.insertCell().textContent = value;
    }
    return tr;
  }

  function renderMatrix(study) {
    const table = el("table", undefined, "study-matrix-table");
    table.append(el("caption", "Work orders where reversing A and B changed the action, divided by work orders scored in both orders", "sr"));
    const headings = table.createTHead().insertRow();
    for (const label of ["Behavior", ...study.conditions.map((c) => c.label)]) {
      const th = el("th", label);
      th.scope = "col";
      headings.append(th);
    }
    const body = table.createTBody();
    for (const task of study.tasks) {
      const row = body.insertRow();
      const th = el("th", task.label);
      th.scope = "row";
      row.append(th);
      for (const condition of study.conditions) {
        const trials = study.trials.filter((r) => r.task === task.id && r.condition === condition.id);
        const {valid, flipped, bothCorrect} = orderCounts(trials);
        const cell = row.insertCell();
        cell.textContent = valid ? flipped + "/" + valid : "N/A";
        cell.title = flipped + " of " + valid + " switched action; " + bothCorrect + " correct in both orders";
        if (valid) cell.style.backgroundColor = "hsl(146 35% " + (84 - 26 * flipped / valid) + "%)";
      }
    }
    id("study-matrix").replaceChildren(table);
    id("study-matrix-note").textContent = "Changed action / work orders with valid responses in both orders";
    id("choice-link-summary").textContent = study.trials.length + " generations across " +
      new Set(study.trials.map((r) => r.case_id)).size + " work orders";
  }

  function pairKey(trial) { return JSON.stringify([trial.task, trial.case_id, trial.order]); }

  // Show a change from correct to wrong first. If no such change occurred,
  // surface other wrong choices, then invalid answers, then correct pairs.
  function priority({before, after}) {
    if (before.correct === true && after.correct === false) return 0;
    if (before.correct === false && after.correct === true) return 1;
    if (before.correct === false || after.correct === false) return 2;
    if (before.correct === null || after.correct === null) return 3;
    return 4;
  }

  function arm(trial, condition, label) {
    const card = el("section", undefined, "study-arm");
    const header = el("header");
    const outcome = verdict(trial);
    header.append(el("h4", label), el("span", outcome, "study-verdict " + outcome.toLowerCase()));
    const actions = new Map([...trial.prompt.matchAll(/^([AB])\. (.+)$/gm)].map((match) => [match[1], match[2]]));
    function choiceText(letter) { return letter + (actions.has(letter) ? ". " + actions.get(letter) : ""); }
    const choice = trial.choice === null ? "No valid choice parsed." : "Selected " + choiceText(trial.choice);
    const expected = "Expected " + choiceText(trial.correct_choice);
    const prompt = el("details");
    prompt.open = trial.correct === false;
    prompt.append(el("summary", "Exact prompt"), el("h5", "System message"), el("pre", condition.system || "(No system message)"),
      el("h5", "User message"), el("pre", trial.prompt));
    card.append(header, el("h5", "Model output"), el("pre", trial.response || "(Empty response)"),
      el("p", choice), el("p", expected), prompt);
    return card;
  }

  function render(study) {
    if (study.schema_version !== 1 || !Array.isArray(study.trials) || !study.trials.length)
      throw new Error("No measured generation records.");
    const {trials, conditions, tasks} = study;
    renderMatrix(study);
    const baseline = conditions.find((c) => c.id === "clean");
    if (!baseline || conditions.length < 2) throw new Error("Missing comparison.");
    const modelLabel = study.model.split("/").at(-1).replace(/-GGUF$/, "");
    const resultsByCondition = conditions.map((c) => orderCounts(trials.filter((r) => r.condition === c.id)));
    const total = (field) => resultsByCondition.reduce((n, result) => n + result[field], 0);
    const validChoices = total("choseA") + total("choseB");
    const selection = total("choseA") === validChoices ? "selected A in all " + validChoices + " valid responses" :
      "selected A in " + total("choseA") + " of " + validChoices + " valid responses";
    id("study-headline").textContent = modelLabel + " " + selection + ". Swapping the two options changed its chosen action in " +
      total("flipped") + " of " + total("valid") + " eligible work-order and condition pairs.";
    const taskLabels = new Map(tasks.map((t) => [t.id, t.label]));
    const cases = new Set(trials.map((r) => JSON.stringify([r.task, r.case_id]))).size;
    id("study-coverage").textContent = study.model + " generated " + trials.length + " responses across " + cases +
      " work orders. Each prompt asked for one of two possible next actions. These are single-turn decisions without SQL execution or persistent memory.";
    const design = id("study-design");
    if (study.design.description) design.append(el("p", study.design.description));
    if (study.design.parser) design.append(el("p", study.design.parser));
    const runtime = typeof study.runtime === "string" ? study.runtime : JSON.stringify(study.runtime);
    design.append(el("p", "Model: " + study.model + " · Revision: " + study.revision + " · Runtime: " + runtime));
    design.append(el("p", "The denominator counts generations, including repeated presentations of each work order. The refund cases reuse three reconciliation templates with different payment amounts and order IDs. Read the exact prompts, outputs and expected choices in the trial records."));

    const treatment = id("study-condition");
    for (const c of conditions.filter((c) => c.id !== baseline.id)) treatment.add(new Option(c.label, c.id));
    const baselineRows = trials.filter((r) => r.condition === baseline.id);
    const baselines = new Map(baselineRows.map((r) => [pairKey(r), r]));
    const caseSelect = id("study-case");
    let paired = [];
    let selected;

    function updatePair() {
      const pair = paired[caseSelect.selectedIndex];
      const panel = id("study-pair");
      if (!pair) {
        id("pair-finding").textContent = "No matched work orders in this condition.";
        panel.replaceChildren();
        return;
      }
      const {before, after} = pair;
      const first = verdict(before).toLowerCase();
      const second = verdict(after).toLowerCase();
      const reversed = before.order !== after.order;
      const firstCondition = conditions.find((c) => c.id === before.condition);
      const secondCondition = conditions.find((c) => c.id === after.condition);
      const labels = reversed ? ["Compliant action first", "Compliant action second"] : [firstCondition.label, secondCondition.label];
      const comparison = first === second ? "Both responses were " + first + "." :
        labels[0] + " was " + first + ". " + labels[1] + " was " + second + ".";
      id("pair-finding").textContent = taskLabels.get(after.task) + " · " + after.case_id + " · " + (reversed ? firstCondition.label + ". " : "") + comparison;
      panel.replaceChildren(arm(before, firstCondition, labels[0]), arm(after, secondCondition, labels[1]));
    }

    function updateCondition() {
      selected = conditions.find((c) => c.id === treatment.value);
      const treatmentRows = trials.filter((r) => r.condition === selected.id);
      id("study-order-rows").replaceChildren(renderOrderRow(baselineRows, baseline.label),
        renderOrderRow(treatmentRows, selected.label));
      const graphs = id("study-graphs");
      graphs.replaceChildren();
      for (const task of tasks) {
        const group = el("section", undefined, "study-group");
        group.append(el("h4", task.label), chartRow(baselineRows.filter((r) => r.task === task.id), baseline, false),
          chartRow(treatmentRows.filter((r) => r.task === task.id), selected, true));
        graphs.append(group);
      }
      const promptPairs = treatmentRows.map((after) => ({before: baselines.get(pairKey(after)), after})).filter((p) => p.before);
      const valid = promptPairs.filter((p) => p.before.correct !== null && p.after.correct !== null);
      const regressions = valid.filter((p) => p.before.correct && !p.after.correct).length;
      const gains = valid.filter((p) => !p.before.correct && p.after.correct).length;
      id("study-changes").textContent = valid.length + " pairs had valid answers in both conditions. " +
        regressions + " changed from correct to wrong and " + gains + " from wrong to correct.";
      const mode = id("study-pair-mode").value;
      if (mode === "prompt") paired = promptPairs;
      else {
        const rows = mode === "order-clean" ? baselineRows : treatmentRows;
        const byCase = new Map(rows.filter((r) => r.order === "AB").map((r) => [r.case_id, r]));
        paired = rows.filter((r) => r.order === "BA").map((after) => ({before: byCase.get(after.case_id), after})).filter((p) => p.before);
      }
      paired.sort((a, b) => priority(a) - priority(b) || a.after.case_id.localeCompare(b.after.case_id));
      caseSelect.replaceChildren();
      for (const {before, after} of paired) {
        const orderLabel = mode === "prompt" ? " · expected " + after.correct_choice : "";
        const label = after.case_id + orderLabel + " · " + verdict(before) + " / " + verdict(after);
        caseSelect.add(new Option(label, pairKey(after)));
      }
      updatePair();
    }
    updateCondition();
    treatment.addEventListener("change", updateCondition);
    id("study-pair-mode").addEventListener("change", updateCondition);
    caseSelect.addEventListener("change", updatePair);
    id("study-body").hidden = false;
  }

  async function summarizeLinkedStudy(file, target, format) {
    try {
      const response = await fetch(file);
      if (!response.ok) return;
      id(target).textContent = format(await response.json());
    } catch {
      // Keep the descriptive study link available if its data cannot load.
    }
  }

  summarizeLinkedStudy("sql-study.json", "sql-link-summary", ({trials}) => {
    const passed = trials.filter((r) => r.status === "passed").length;
    const failed = trials.filter((r) => r.status === "failed").length;
    const errors = trials.filter((r) => r.status === "error").length;
    return passed + " passed · " + failed + " failed · " + errors + " errors";
  });

  summarizeLinkedStudy("smoothing-results.json", "smoothing-link-summary", ({summary}) =>
    summary.voted_correct + "/" + summary.presentations + " correct by vote · " +
    summary.clean_correct + "/" + summary.presentations + " clean"
  );

  fetch("behavior-study.json")
    .then((response) => {
      if (!response.ok) throw new Error("Study data unavailable.");
      return response.json();
    })
    .then(render)
    .catch(() => {
      id("study-matrix").replaceChildren(el("p", "Study records unavailable."));
      id("study-coverage").textContent = "The study records could not be loaded. Reload the page or open the trial download.";
    });
})();
