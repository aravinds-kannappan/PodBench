/* Frozen outcomes and exploratory diagnostics use separate source files and denominators. */
window.PBResults = (() => {
  "use strict";
  const { el, panel, table, bars, heat, dots, lines, flow, selector, link, empty, fmt, percent, uniq, title } = PB;
  const models = { "qwen2.5-0.5b": "Qwen2.5-0.5B", "smollm2-360m": "SmolLM2-360M" };
  const arms = { baseline: "Generic", inspect_first: "Verify first" };
  const arm = (key) => arms[key] ?? title(key);
  const model = (key) => models[key] ?? key;
  const control = (parent) => {
    const node = el("div", null, "controls");
    parent.append(node);
    return node;
  };
  const ratio = (n, d) => String(n) + "/" + String(d);

  function perModel(target, rows, draw, extra) {
    const controls = control(target),
      chart = el("div");
    const names = uniq(rows.map((r) => r.model).filter(Boolean));
    if (!names.length) {
      empty(target);
      return;
    }
    let selected = names[0],
      key = extra?.choices[0]?.[0];
    function update() {
      chart.replaceChildren();
      draw(
        chart,
        rows.filter((r) => r.model === selected),
        key,
        selected,
      );
    }
    selector(
      controls,
      "Model",
      names.map((m) => [m, model(m)]),
      selected,
      (value) => {
        selected = value;
        update();
      },
    );
    if (extra)
      selector(controls, extra.name, extra.choices, key, (value) => {
        key = value;
        update();
      });
    target.append(chart);
    update();
  }
  function leaderboard(target, name, headings, rows) {
    const board = table(target, name, headings, rows);
    const body = board.tBodies[0];
    const items = Array.from(body.rows, (element, index) => ({ element, index, cells: rows[index] }));
    const columns = [...board.tHead.rows[0].cells];
    const labels = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const rate = (v) => {
      const [count, total] = v.split(" ")[0].split("/").map(Number);
      return total ? count / total : null;
    };
    columns.forEach((header, col) => {
      const label = headings[col];
      const button = el("button", label, "sort-header");
      button.type = "button";
      button.setAttribute("aria-label", "Sort by " + label);
      const arrow = el("span", "↕", "sort-arrow");
      arrow.setAttribute("aria-hidden", "true");
      button.append(arrow);
      header.replaceChildren(button);
      button.addEventListener("click", () => {
        const numeric = col >= 2 && col <= 7;
        const previous = header.getAttribute("aria-sort");
        const descending = previous === "ascending" || (previous === null && numeric);
        for (const th of columns) {
          th.removeAttribute("aria-sort");
          th.querySelector(".sort-arrow").textContent = "↕";
        }
        header.setAttribute("aria-sort", descending ? "descending" : "ascending");
        arrow.textContent = descending ? "↓" : "↑";
        const sign = descending ? -1 : 1;
        function value(item) {
          const cell = item.cells[col];
          return col >= 3 && col <= 7 ? rate(cell) : cell;
        }
        const sorted = [...items].sort((a, b) => {
          const x = value(a),
            y = value(b);
          if (x == null && y != null) return 1;
          if (y == null && x != null) return -1;
          const order = numeric ? x - y : labels.compare(x, y);
          return sign * order || a.index - b.index;
        });
        body.append(...sorted.map((item) => item.element));
      });
    });
  }
  function frozenBoard(target, data) {
    const p = panel(
      target,
      "frozen",
      "Recovery leaderboard",
      "Each row is a model and instruction evaluated on the same scheduled work orders. A verified recovery requires an exact database state and an explicit submission.",
    );
    const values = [];
    for (const m of data.by_model)
      for (const [condition, a] of Object.entries(m.by_instruction)) {
        const denom = a.valid_turns + a.invalid_turns;
        const inspected = ratio(a.first_inspection, a.first_decisions);
        values.push([
          model(m.model),
          arm(condition),
          a.scheduled,
          inspected,
          ratio(a.submitted, a.scheduled),
          ratio(a.exact_state, a.scheduled),
          ratio(a.passed, a.scheduled),
          ratio(a.invalid_turns, denom) + " (" + percent(a.invalid_turns, denom) + ")",
          a.submitted_inexact + " inexact, " + a.step_limit + " at limit",
        ]);
      }
    leaderboard(
      p,
      "Frozen model and instruction results",
      [
        "Model",
        "Instruction",
        "Episodes",
        "Inspected first",
        "Submitted",
        "Exact state",
        "Exact + submitted",
        "Invalid decisions",
        "Terminal failures",
      ],
      values,
    );
    p.append(
      el(
        "p",
        "Invalidity is counted per decoded decision. First inspection uses episodes with a first decision. All other fractions in the central outcome columns use scheduled episodes.",
        "note",
      ),
    );
    const reports = el("div", null, "refs");
    reports.append(
      link("Download frozen data", "data/frozen.json"),
      link("What changed in the intervention runs?", "#what-changed"),
    );
    p.append(reports);
    const plot = panel(
      target,
      "frozen",
      "What each model completed",
      "Compare the same endpoint across the two instruction conditions.",
    );
    const rows = data.by_model.flatMap((m) =>
      Object.entries(m.by_instruction).map(([instruction, counts]) => ({ model: m.model, instruction, counts })),
    );
    perModel(plot, rows, (out, slice) => {
      const keys = [
        ["first_inspection", "Inspected first", "first_decisions"],
        ["submitted", "Submitted", "scheduled"],
        ["exact_state", "Exact state", "scheduled"],
        ["passed", "Exact + submitted", "scheduled"],
      ];
      const measures = slice.flatMap(({ instruction, counts }) =>
        keys.map(([k, name, d]) => ({
          group: name,
          series: arm(instruction),
          value: counts[d] ? (100 * counts[k]) / counts[d] : null,
          basis: ratio(counts[k], counts[d]),
        })),
      );
      bars(
        out,
        "Frozen outcome rates",
        "Horizontal bars show percent of eligible episodes for each outcome. Counts and denominators are in the data table.",
        measures,
        { max: 100, unit: "%" },
      );
    });
  }
  function exploratoryBoard(target, summary) {
    const box = panel(
      target,
      "exploratory",
      "Failure mix on the archived episodes",
      "This reanalysis reconstructs the outcomes and failure labels from the same archived episodes as the frozen study. Invalid decisions use the number of decoded turns as their denominator.",
    );
    const rows = summary.groups;
    const all = rows.map((g) => {
      const mix = Object.entries(g.failures)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => title(k) + " " + n)
        .join(", ");
      return [
        model(g.model),
        arm(g.instruction),
        g.n,
        ratio(g.first_inspection, g.n),
        ratio(g.submitted, g.n),
        ratio(g.exact_state, g.n),
        ratio(g.passed, g.n),
        ratio(g.invalid_turns, g.decisions) + " (" + percent(g.invalid_turns, g.decisions) + ")",
        mix,
      ];
    });
    leaderboard(
      box,
      "Outcomes and failure labels reconstructed from the episode archive",
      [
        "Model",
        "Instruction",
        "Episodes",
        "Inspected first",
        "Submitted",
        "Exact state",
        "Exact + submitted",
        "Invalid decisions",
        "Failure mix",
      ],
      all,
    );
    const destinations = el("div", null, "refs");
    destinations.append(
      link("Inspect the taxonomy", "#failure-taxonomy"),
      link("See the matched handoff-note experiment", "#what-changed"),
    );
    box.append(destinations);
  }
  async function home(ctx) {
    ctx.hero(
      "Recovery after an uncertain commit",
      "How do agents resume a database job when the previous write may already have committed? Compare verified outcomes, follow a decision and inspect the evidence behind each failure.",
      [
        ["Read the paper", "#paper"],
        ["Explore a trajectory", "#trajectory"],
        ["Download data", "#methods"],
      ],
      true,
    );
    const toggles = el("div", null, "switch"),
      body = el("div");
    ctx.main.append(toggles, body);
    const view = ctx.params.get("view") === "exploratory" ? "exploratory" : "frozen";
    for (const [key, label] of [
      ["frozen", "Frozen results"],
      ["exploratory", "Exploratory reanalysis"],
    ]) {
      const button = el("button", label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(key === view));
      button.addEventListener("click", () => ctx.go("home", { view: key }));
      toggles.append(button);
    }
    if (view === "frozen") frozenBoard(body, await ctx.data("frozen"));
    else exploratoryBoard(body, await ctx.data("summary"));
  }
  async function changed(ctx) {
    ctx.hero(
      "What changed?",
      "The frozen benchmark asks whether a job finished. The exploratory analyses ask where its recovery stopped and which counterfactual actions were still available.",
    );
    const [f, s, episodes] = await Promise.all([ctx.data("frozen"), ctx.data("summary"), ctx.data("episodes")]);
    const comparison = el("div", null, "cols");
    ctx.main.append(comparison);
    const left = panel(
      comparison,
      "frozen",
      "Original paired comparison",
      "Only the instruction changes within a matched pair. Model, task, fixture, commit outcome and menu order stay fixed.",
    );
    table(
      left,
      "Frozen paired differences",
      ["Model", "Generic", "Verify first", "Difference, pp", "Improved pairs", "Regressed pairs"],
      f.by_model.map((m) => [
        model(m.model),
        ratio(m.by_instruction.baseline.passed, m.pairs),
        ratio(m.by_instruction.inspect_first.passed, m.pairs),
        fmt.format(100 * m.difference),
        m.improvement_pairs,
        m.regression_pairs,
      ]),
    );
    left.append(
      link(
        "Frozen protocol",
        "https://github.com/aravinds-kannappan/PodBench/blob/f4ef7fdf31b98fa95046f1ff5ca6461b4a192271/research/recovery/PROTOCOL.md",
      ),
    );
    const right = panel(
      comparison,
      "exploratory",
      "Additional measurements",
      "Original prompts, decisions and verifier outcomes remain the unit of analysis for the replay. Scores attach probabilities to recorded decisions. Forcing and intervention experiments add separately labeled counterfactual model continuations.",
    );
    table(
      right,
      "Analysis sources",
      ["Analysis", "Unit", "Where to inspect"],
      [
        ["Trajectory replay", "Archived decision", link("Trajectory viewer", "#trajectory")],
        [
          "Failure label and deadline",
          "Archived episode and decision prefix",
          link("Failure taxonomy", "#failure-taxonomy"),
        ],
        [
          "Menu scoring",
          "Candidate action at a recorded prefix",
          link("Instruction explainer", "#instruction-explainer"),
        ],
        ["Input and activation interventions", "Matched intervention and control", link("Probes", "#probes")],
      ],
    );
    const byId = new Map(f.episodes.map((e) => [e.id, e]));
    const submittedInexact = episodes.filter((r) => byId.get(r.id)?.classification === "submitted_inexact");
    const premature = submittedInexact.filter((r) => r.label === "premature submit");
    const duplicates = submittedInexact.filter((r) => r.label === "duplicate write");
    const firstLost = episodes.filter((r) => r.first_unreachable_submission === 1);
    const submittedFirst = firstLost.filter((r) => r.first_action === "submit");
    const duplicatedFirst = firstLost.filter((r) => r.first_action !== "submit" && r.label === "duplicate write");
    right.append(
      el(
        "p",
        "The frozen verifier counted " +
          submittedInexact.length +
          " inexact submissions. The exclusive taxonomy assigns " +
          premature.length +
          " of those to premature submit and " +
          duplicates.length +
          " to duplicate write, which has higher precedence.",
        "diagnostic",
      ),
    );
    right.append(
      el(
        "p",
        "On the first decision, " +
          firstLost.length +
          " episodes lost the last path to an exact submitted state. Of those, " +
          submittedFirst.length +
          " immediately submitted, and " +
          duplicatedFirst.length +
          " made a duplicate write.",
      ),
    );
    const probeData = await ctx.data("probes");
    const note = probeData.blackbox.variants.find((r) => r.id === "handoff_note");
    if (note) {
      const experiment = panel(
        ctx.main,
        "exploratory",
        "A prior worker suggested immediate submission",
        "These additional paired runs compare a note requesting immediate submission with the original handoff. Rows show whether the first autonomous decision was submit, with model and work order matched.",
      );
      table(
        experiment,
        "Immediate submission with and without the note",
        ["Model", "Control", "With the note", "Began submitting", "Stopped submitting"],
        Object.entries(note.by_model).map(([id, r]) => {
          const event = r.first_actions.submit;
          return [
            model(id),
            ratio(event?.control ?? 0, r.n),
            ratio(event?.treatment ?? 0, r.n),
            event?.gained ?? 0,
            event?.lost ?? 0,
          ];
        }),
      );
      experiment.append(
        link(
          "Compare instruction-conflict interventions",
          ctx.url("probes", { family: "instruction_conflict", outcome: "action:submit" }),
        ),
      );
    }
    const orders = probeData.blackbox.permutations;
    const totals = probeData.blackbox.permutation_summaries.filter((r) => r.first_menu_entry === "all");
    if (totals.length) {
      const changes = panel(
        ctx.main,
        "exploratory",
        "What happened when the same menu was reordered?",
        "Within each task, the same checkpoint worked on one committed work order under every ordering of its action names. Each denominator counts menu layouts on that work order.",
      );
      table(
        changes,
        "Verified recovery across the menu-order sweep",
        [
          "Model",
          "Task",
          "Reference layout passed",
          "All layouts submitted",
          "All layouts exact",
          "All layouts passed",
        ],
        totals.map((r) => {
          const base = orders.find((o) => o.model === r.model && o.task === r.task && o.id === o.control);
          return [
            model(r.model),
            title(r.task),
            base ? ratio(Number(base.passed), 1) : null,
            ratio(r.submitted, r.orders),
            ratio(r.exact_state, r.orders),
            ratio(r.passed, r.orders),
          ];
        }),
      );
      changes.append(link("Inspect the individual menu orders", ctx.url("probes", { section: "permutations" })));
    }
    deadlines(ctx.main, s);
    forcing(ctx.main, s);
  }
  function deadlines(target, s) {
    const p = panel(
      target,
      "exploratory",
      "When did recovery become unreachable?",
      "Replay tests which target states can still be reached within the remaining decision budget. The two endpoints differ because submission also consumes a turn.",
    );
    perModel(p, s.deadlines, (out, rs) => {
      const rows = rs.flatMap((r) =>
        [
          ["exact_state", "Exact state"],
          ["exact_submitted", "Exact + submit"],
        ].map(([k, l]) => ({
          x: r.turn,
          series: arm(r.instruction) + " · " + l,
          value: r[k],
          basis: ratio(r[k], r.total) + " episodes",
        })),
      );
      lines(
        out,
        "Cumulative unreachable episodes",
        "Each point counts all episodes that first became unreachable at or before the displayed turn. The table gives the full cohort denominator.",
        rows,
      );
    });
  }
  function forcing(target, s) {
    const p = panel(
      target,
      "exploratory",
      "Recovery after forcing a decision",
      "Each branch replaces one decision and returns control to the model. The oracle knows whether the first write committed. The evidence-based policy inspects when the observed history fits both worlds. Both policies use the remaining turn budget.",
    );
    perModel(p, s.forcing, (out, rs) => {
      const rows = rs.map((r) => ({
        x: r.turn,
        series: arm(r.instruction) + " · " + title(r.policy),
        value: r.eligible ? (100 * r.success) / r.eligible : null,
        basis: ratio(r.success, r.eligible) + " eligible of " + r.total,
      }));
      lines(
        out,
        "Forced success by decision turn",
        "Percent successful among eligible forced continuations. Later turns can have different eligible populations.",
        rows,
        { unit: "%" },
      );
    });
  }
  async function instructions(ctx) {
    ctx.hero(
      "The instruction explainer",
      "A small change to the recovery request can change the first action while leaving the final verdict unchanged. Inspect the words, action rankings and the model’s response to new evidence.",
    );
    const s = await ctx.data("summary");
    const ex = panel(
      ctx.main,
      "exploratory",
      "What the agent was asked to do",
      "Both arms see an interrupted work order, the same named actions and the same turn budget for each matched fixture.",
    );
    const archive = await ctx.data("episodes");
    const basic = archive.find((r) => r.instruction === "baseline");
    const matching = archive.find(
      (r) =>
        r.instruction === "inspect_first" &&
        ["model", "task", "seed", "committed", "menu_order"].every((key) => r[key] === basic[key]),
    );
    const [generic, verified] = await Promise.all([ctx.json(basic.url), ctx.json(matching.url)]);
    const appended = verified.system.startsWith(generic.system);
    ex.append(
      el("h3", "Generic instruction"),
      el("blockquote", generic.system),
      el("h3", appended ? "Added in the verify-first condition" : "Verify-first instruction"),
      el("blockquote", appended ? verified.system.slice(generic.system.length).trim() : verified.system),
    );
    const prompts = el("div", null, "refs");
    prompts.append(
      link("Generic trajectory", ctx.url("trajectory", { id: basic.id, turn: 1 })),
      link("Matched verify-first trajectory", ctx.url("trajectory", { id: matching.id, turn: 1 })),
    );
    ex.append(prompts);
    const first = panel(
      ctx.main,
      "exploratory",
      "First action by menu and hidden state",
      "Cells count observed first decisions. Select a model and compare the same instruction with its menu reversed.",
    );
    perModel(first, s.first_actions, (out, rs) => {
      const rows = rs.map((r) => ({
        group: arm(r.instruction) + " · " + r.menu_order + " · " + (r.committed ? "committed" : "absent"),
        series: title(r.action),
        value: r.total ? r.count / r.total : 0,
        basis: ratio(r.count, r.total),
      }));
      heat(
        out,
        "First-decision heatmap",
        "Darker and lighter cells encode the fraction of episodes choosing each action. Every observed cell shows its count and denominator.",
        rows,
      );
    });
    const shifts = panel(
      ctx.main,
      "exploratory",
      "How the menu probabilities moved",
      "Each dot is a fixture-level difference in the normalized probability of a complete candidate action under the two instructions.",
    );
    perModel(shifts, s.shifts, (out, rs) => {
      dots(
        out,
        "Verify-first minus generic probability",
        "Horizontal position gives the paired difference in percentage points. Colored dots distinguish task families. Read exact fixture IDs and denominators in the table.",
        rs.map((r) => ({
          group: title(r.action),
          series: title(r.task),
          value: r.delta == null ? null : 100 * r.delta,
          basis: "seed " + r.seed + (r.pairs ? " · " + r.pairs + " pairs" : ""),
        })),
        { unit: " pp" },
      );
    });
    const uncertainty = panel(
      ctx.main,
      "exploratory",
      "Uncertainty over the action menu",
      "Entropy measures dispersion across normalized candidate probabilities. The margin measures the log-probability gap between the two highest-scoring candidates.",
    );
    perModel(
      uncertainty,
      s.steps,
      (out, rs, key) => {
        lines(
          out,
          "Menu " + (key === "entropy_nats" ? "entropy" : "margin") + " by turn",
          "Mean nats over scored decisions reaching each turn. The population can change as episodes submit or reach the limit.",
          rs.map((r) => ({ x: r.turn, series: arm(r.instruction), value: r[key], basis: r.n + " decisions" })),
        );
      },
      {
        name: "Measure",
        choices: [
          ["entropy_nats", "Menu entropy"],
          ["margin_nats", "Top-two margin"],
        ],
      },
    );
    const explainer = s.explainer;
    const summaries = explainer.conditions;
    const box = panel(
      ctx.main,
      "exploratory",
      "The four model and instruction accounts",
      "Inspect which actions were decoded, how certain the legal menu distribution was, and how that changed after an observed tool result.",
    );
    const nformat = (n) => (n == null ? "unobserved" : fmt.format(n));
    for (const row of summaries) {
      const card = el("details", null, "disclose");
      card.append(el("summary", model(row.model) + " · " + arm(row.instruction)));
      card.append(
        el(
          "p",
          (row.first_actions.inspect ?? 0) +
            "/" +
            row.first_n +
            " episodes began with inspection. Mean normalized probability for the full inspect response was " +
            percent(row.first_mean_inspect, 1) +
            ".",
        ),
      );
      const cells = row.turns.map((r) => [
        r.turn,
        r.n,
        Object.entries(r.chosen)
          .map(([a, n]) => a + " × " + n)
          .join(", "),
        nformat(r.mean_entropy_nats),
        r.top_first_tokens
          .slice(0, 3)
          .map((t) => JSON.stringify(t.text) + " (" + t.top_one_count + " top-ranked)")
          .join(", "),
      ]);
      table(
        card,
        "Decoded choices and next-token evidence by decision",
        ["Turn", "Decisions", "Decoded choices", "Entropy, nats", "Leading next tokens"],
        cells,
      );
      if (row.example_swap)
        card.append(
          link(
            "Inspect the largest observed swap in this condition",
            ctx.url("trajectory", { id: row.example_swap.episode_id, turn: row.example_swap.turn }),
          ),
        );
      card.append(el("p", null, "refs"));
      card.lastChild.append(
        link(
          "Read the condition analysis",
          "https://github.com/aravinds-kannappan/PodBench/blob/main/research/recovery/mechanism/explain-" +
            row.model +
            "-" +
            row.instruction +
            ".md",
        ),
      );
      box.append(card);
    }
    const swap = panel(
      ctx.main,
      "exploratory",
      "Swapping the inspection result",
      "These counterfactual scores replace the latest observation with the corresponding result from the other prior-write world. Total variation distance measures movement over the complete legal action distribution.",
    );
    table(
      swap,
      "Paired observation swaps",
      ["Model", "Instruction", "Swaps", "Observations changed", "Top action changed", "Mean TV distance"],
      summaries.map((r) => [
        model(r.model),
        arm(r.instruction),
        r.post_inspect.n,
        r.post_inspect.changed_inputs,
        r.post_inspect.top_flips ?? 0,
        r.post_inspect.mean_tv,
      ]),
    );
    PB.chartData(
      swap,
      "Individual scored swaps",
      ["Episode", "Turn", "Input changed", "Original top", "Swapped top", "TV distance"],
      explainer.swap_contrasts.map((r) => [
        r.episode_id,
        r.turn,
        r.observation_changed,
        r.logged_top,
        r.swapped_top,
        r.tv,
      ]),
    );
    const refs = el("div", null, "refs");
    refs.append(
      link(
        "Read the one-page instruction comparison",
        "https://github.com/aravinds-kannappan/PodBench/blob/main/research/recovery/mechanism/explain-comparison.md",
      ),
      link("Download scores and comparison tables", "data/summary.json"),
      link(
        "Scoring method",
        "https://github.com/aravinds-kannappan/PodBench/blob/main/research/recovery/mechanism/scores-method.md",
      ),
    );
    swap.append(refs);
  }
  async function failures(ctx) {
    ctx.hero(
      "Failure taxonomy",
      "A terminal verdict can conceal different failure paths. Compare mutually exclusive episode labels, then follow the first decisions that led to them.",
    );
    const s = await ctx.data("summary");
    const box = panel(
      ctx.main,
      "exploratory",
      "Terminal failure labels",
      "Each archived episode receives one label under the published priority rules. Counts are descriptive and depend on that ordering.",
    );
    const rows = s.groups.flatMap((r) =>
      Object.entries(r.failures).map(([key, n]) => ({
        group: model(r.model) + " · " + arm(r.instruction),
        series: title(key),
        value: n,
        basis: ratio(n, r.n),
      })),
    );
    bars(
      box,
      "Failure composition",
      "Each segment counts episodes assigned to one terminal label. A full bar covers one model and instruction combination.",
      rows,
      { stack: true },
    );
    const names = [
      ["exact state without submit", "All database endpoints matched, but the episode never submitted."],
      ["wrong-row write", "The protected-row check failed."],
      ["duplicate write", "The final refund, stock increment or archive copy exceeded its target."],
      ["no valid decision", "Every reply failed the frozen exact-name parser."],
      ["premature submit", "The episode submitted an inexact state after the earlier categories were excluded."],
      ["invalid-action loop", "The episode ended in a repeating suffix of invalid replies after a valid decision."],
      ["repeated-action loop", "Valid actions repeated at the end of the episode."],
      ["incomplete reconciliation", "The episode ran out of turns with unfinished state or follow-up operations."],
    ];
    const rules = el("details", null, "disclose");
    rules.append(el("summary", "Definitions and assignment order"));
    table(
      rules,
      "Exclusive failure precedence",
      ["First matching label", "Definition", "Episodes"],
      names.map(([k, d]) => [title(k), d, link("Find episodes", ctx.url("trajectory", { label: k }))]),
    );
    box.append(rules, link("Inspect specific episodes", "#trajectory"));
    const flowBox = panel(
      ctx.main,
      "exploratory",
      "From first decision to final outcome",
      "A path groups episodes by first action, second action and terminal label. A wider connection represents more episodes.",
    );
    perModel(
      flowBox,
      s.flows,
      (out, rs, key) =>
        flow(
          out,
          "First action, second action, terminal outcome",
          "Connection widths are proportional to episode counts in the selection. Exact path counts are available below.",
          rs.filter((r) => r.instruction === key),
        ),
      { name: "Instruction", choices: Object.entries(arms) },
    );
    deadlines(ctx.main, s);
  }
  return { home, changed, instructions, failures, model, arm, control, perModel };
})();
