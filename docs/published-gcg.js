"use strict";

async function loadPublishedScores() {
  const model = document.getElementById("archive-model");
  const judge = document.getElementById("archive-judge");
  const status = document.getElementById("archive-status");
  try {
    const response = await fetch("published-gcg.json");
    if (!response.ok) throw new Error("Could not load published scores.");
    const { models } = await response.json();
    for (const record of models) model.add(new Option(record.model, record.model));

    function render() {
      const body = document.getElementById("archive-rows");
      body.replaceChildren();
      const selected = models.find((record) => record.model === model.value);
      document.getElementById("archive-heading").textContent = selected ? "Behavior category" : "Model";
      function addRow(label, setting, successful, scored) {
        const row = body.insertRow();
        const heading = document.createElement("th");
        heading.scope = "row";
        heading.textContent = label;
        row.append(heading);
        row.insertCell().textContent = setting === "white_box" ? "White-box" : "Transfer";
        const cell = row.insertCell();
        if (scored) {
          const meter = document.createElement("meter");
          meter.setAttribute("aria-label", label + " attack success rate");
          meter.max = scored;
          meter.value = successful;
          cell.append(meter, " " + Math.round(successful / scored * 100) + "%");
        } else cell.textContent = "Unscored";
        row.insertCell().textContent = successful + " / " + scored;
      }
      if (selected) {
        for (const [category, verdicts] of Object.entries(selected.categories)) {
          const { successful, scored } = verdicts[judge.value];
          addRow(category, selected.setting, successful, scored);
        }
      } else {
        for (const record of models) {
          let successes = 0;
          let total = 0;
          for (const verdicts of Object.values(record.categories)) {
            successes += verdicts[judge.value].successful;
            total += verdicts[judge.value].scored;
          }
          addRow(record.model, record.setting, successes, total);
        }
      }
      status.textContent = selected
        ? selected.model + " · " + Object.keys(selected.categories).length + " categories · " + selected.cases + " cases"
        : "Four models · 100 scored cases per model";
    }
    model.addEventListener("change", render);
    judge.addEventListener("change", render);
    render();
    document.getElementById("archive-table").hidden = false;
    model.disabled = judge.disabled = false;
  } catch {
    status.textContent = "Published scores could not be loaded. The aggregate counts can be downloaded below.";
  }
}

loadPublishedScores();
