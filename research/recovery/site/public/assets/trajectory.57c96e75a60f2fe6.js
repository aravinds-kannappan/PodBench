window.PBTrajectory = async function (ctx) {
  "use strict";
  const { el, link, panel, table, selector, empty, bars, title, fmt, uniq, percent } = PB;
  const { model, arm, control } = PBResults;
  ctx.hero(
    "Trajectory viewer",
    "Follow one work order from handoff to final database state. Each decision links to the recorded reply, tool result, state change and scored action menu.",
  );
  const index = await ctx.data("episodes");
  const filters = panel(
    ctx.main,
    "exploratory",
    "Select an episode",
    "Use any combination of filters. The address bar preserves the selected episode and decision.",
  );
  const ctrls = control(filters);
  const choices = [
    ["model", "Model", model],
    ["instruction", "Instruction", arm],
    ["task", "Task family", title],
    ["label", "Failure label", title],
    ["menu_order", "Menu order", title],
  ];
  const match = {};
  for (const [k, l, f] of choices) {
    const keys = uniq(index.map((r) => r[k]).filter((v) => v != null)).sort();
    match[k] = keys.includes(ctx.params.get(k)) ? ctx.params.get(k) : "";
    selector(ctrls, l, [["", "All"], ...keys.map((v) => [v, f(v)])], match[k], (v) =>
      ctx.update({ [k]: v, id: null, turn: null }),
    );
  }
  match.world = ctx.params.get("world") || "";
  selector(
    ctrls,
    "Prior write",
    [
      ["", "Both outcomes"],
      ["committed", "Committed"],
      ["absent", "Absent"],
    ],
    match.world,
    (v) => ctx.update({ world: v, id: null, turn: null }),
  );
  const rows = index.filter(
    (r) =>
      choices.every(([k]) => !match[k] || r[k] === match[k]) &&
      (!match.world || r.committed === (match.world === "committed")),
  );
  if (!rows.length) {
    empty(filters, "No episodes match these filters.");
    return;
  }
  const requested = ctx.params.get("id");
  const selected = rows.find((r) => r.id === requested) ?? rows[0];
  if (requested && selected.id !== requested)
    filters.append(el("p", "The linked episode is unavailable in this selection. Showing the first match.", "note"));
  selector(
    ctrls,
    "Episode",
    rows.map((r) => [r.id, r.id]),
    selected.id,
    (id) => ctx.update({ id, turn: "1" }),
  );
  filters.append(
    el(
      "p",
      rows.length +
        " matching episodes. The selected episode was labeled " +
        title(selected.label ?? "unclassified") +
        ".",
      "note",
    ),
  );
  const episode = await ctx.json(selected.url);
  const steps = episode.steps ?? [];
  const num = Number(ctx.params.get("turn")) || 1;
  const step = steps.find((s) => s.turn === num) ?? steps[0];
  const url = (turn) => ctx.url("trajectory", { ...Object.fromEntries(ctx.params), id: selected.id, turn });
  const header = panel(
    ctx.main,
    "exploratory",
    "Handoff and reachability",
    "Database state and the hidden commit outcome are evaluator metadata. The visible handoff and system message are included separately.",
  );
  const grid = el("dl", null, "meta-grid");
  const deadline = (v) => (v == null ? "No recorded crossing" : "Turn " + v);
  const details = [
    ["Model", model(selected.model)],
    ["Task", title(selected.task) + " · seed " + selected.seed],
    ["Instruction", arm(selected.instruction)],
    ["Prior write", selected.committed ? "Committed" : "Absent"],
    ["Exact state first unreachable", deadline(selected.first_unreachable_exact)],
    ["Exact + submitted first unreachable", deadline(selected.first_unreachable_submission)],
  ];
  for (const [k, v] of details) {
    const item = el("div");
    item.append(el("dt", k), el("dd", v));
    grid.append(item);
  }
  header.append(grid);
  const prompt = el("details", null, "disclose");
  prompt.append(
    el("summary", "Read the system message and work order"),
    el("h3", "System message"),
    el("pre", episode.system),
    el("h3", "Work order"),
    el("pre", episode.prompt),
  );
  header.append(prompt);
  if (!step) {
    empty(header, "No decoded decision was recorded in this episode.");
    return;
  }
  const summary = panel(
    ctx.main,
    "exploratory",
    "Decision " + step.turn,
    "Open a turn to inspect its model reply, the environment feedback, and the action probabilities at that prefix.",
  );
  summary.dataset.turnDetail = String(step.turn);
  const timeline = el("nav", null, "timeline");
  timeline.setAttribute("aria-label", "Decision turns");
  steps.forEach((s) => {
    const a = link("Turn " + s.turn, url(s.turn));
    if (s.turn === step.turn) a.setAttribute("aria-current", "step");
    timeline.append(a);
  });
  summary.append(timeline);
  const inferred = step.action ?? "Unparsed";
  summary.append(
    el("h3", "Selected action"),
    el(
      "p",
      inferred +
        (step.position_1based != null ? " · menu position " + step.position_1based : "") +
        (step.parse_failure ? " · " + title(step.parse_failure) : ""),
    ),
  );
  if (step.crossed_exact || step.crossed_submission)
    summary.append(
      el(
        "p",
        "This decision closed the last path to " +
          [step.crossed_exact ? "exact state" : "", step.crossed_submission ? "exact state with submission" : ""]
            .filter(Boolean)
            .join(" and ") +
          ".",
        "diagnostic",
      ),
    );
  const pair = el("div", null, "trace-grid");
  summary.append(pair);
  function raw(label, value) {
    const block = el("div");
    block.append(el("h3", label), el("pre", typeof value === "string" ? value : JSON.stringify(value, null, 2)));
    pair.append(block);
  }
  raw("Raw reply", step.reply ?? "(No reply received)");
  raw("Tool observation", step.observation ?? "(No tool call executed)");
  raw("Database difference from target after this decision", step.diff_after ?? "(No recorded difference)");
  raw("Reachability after decision", {
    exact_state: step.exact_reachable_after,
    exact_and_submitted: step.submission_reachable_after,
    action_loop_period: step.action_loop_period,
  });
  summary.append(
    el(
      "p",
      "The database difference lists extra and missing rows against the desired final state. An empty difference means the rows match. Exact recovery also requires submission.",
      "note",
    ),
  );
  const share = el("div", null, "refs");
  share.append(link("Link to this decision", url(step.turn)), link("Download episode JSON", selected.url));
  summary.append(share);
  const probability = panel(
    ctx.main,
    "exploratory",
    "Action scores at this decision",
    "Log probabilities score complete candidate action names. Menu probabilities normalize over the allowed names. The model's decoded reply can still be unparseable.",
  );
  const entries = Object.entries(step.candidates ?? {});
  if (entries.length) {
    bars(
      probability,
      "Complete action log probabilities",
      "Values closer to zero indicate higher probability under the scoring convention. The basis column gives the normalized menu probability.",
      entries.map(([name, d]) => ({
        group: name,
        series: "Sequence log probability",
        value: d.logprob,
        basis: percent(d.menu_probability, 1) + " of allowed menu",
      })),
      { max: 0 },
    );
    probability.append(
      el(
        "p",
        "Menu entropy " +
          fmt.format(step.menu_entropy_nats) +
          " nats · Top-two margin " +
          fmt.format(step.margin_nats) +
          " nats.",
        "note",
      ),
    );
  } else empty(probability, "Candidate scores were unavailable for this prefix.");
  const diagnostics = el("details", null, "disclose");
  diagnostics.append(el("summary", "Inspection and repetition diagnostics"));
  table(
    diagnostics,
    "Decision diagnostics",
    ["Measure", "Recorded result"],
    [
      ["Reply claims inspection", step.claims_inspection],
      ["Inspection executed before this turn", step.inspected_before],
      ["Executed inspect now", step.executed_inspect],
      ["Same action as previous turn", step.same_action_as_previous],
      ["Valid-action suffix loop period", step.action_loop_period],
      ["Invalid-reply suffix loop period", step.invalid_loop_period],
      ["Unconditional submit log probability", step.submit_logprob],
    ],
  );
  probability.append(diagnostics);
  if (step.top_tokens?.length) {
    const t = el("details", null, "disclose");
    t.append(el("summary", "Top next tokens"));
    table(
      t,
      "Highest-scoring next tokens",
      ["Token ID", "Decoded text", "Probability", "Log probability"],
      step.top_tokens.map((r) => [r.id, r.text, r.probability, r.probability > 0 ? Math.log(r.probability) : null]),
    );
    probability.append(t);
  }
  if (step.forcing) {
    const forced = panel(
      ctx.main,
      "exploratory",
      "Counterfactual continuations",
      "A forced prefix is a separate run. Eligibility records whether the intervention was available at this turn.",
    );
    table(
      forced,
      "Interventions at the selected prefix",
      ["Policy", "Eligible", "Forced action", "Terminal success"],
      Object.entries(step.forcing).map(([k, v]) => [
        title(k),
        v.eligible ? "Yes" : "No",
        v.forced_action,
        v.eligible ? (v.passed ? "Passed" : "No pass") : "Unscored",
      ]),
    );
  }
  const verdict = panel(
    ctx.main,
    "exploratory",
    "Terminal verification",
    "The replay checks endpoint state and submission separately.",
  );
  const final = episode.verdict ?? {};
  verdict.append(
    el(
      "p",
      "The episode ended with status " +
        title(episode.status) +
        " and " +
        (final.passed ? "passed" : "failed") +
        " the exact recovery check.",
    ),
  );
  table(
    verdict,
    "Verifier endpoints",
    ["Endpoint", "Satisfied"],
    Object.entries(final.endpoints ?? {}).map(([k, v]) => [title(k), v ? "Yes" : "No"]),
  );
};
