window.PBProbes = async function (ctx) {
  "use strict";
  const { el, panel, table, selector, empty, bars, dots, lines, chartData, title, uniq, link } = PB;
  const { model, control, perModel } = PBResults;
  ctx.hero(
    "Probes",
    "Compare changes to the text around a decision with interventions inside the model. Each comparison shows its control and the number of eligible cases.",
  );
  const data = await ctx.data("probes");
  const scope = "exploratory";
  const black = data.blackbox,
    white = data.whitebox;

  function blackbox(b) {
    const intro = panel(
      ctx.main,
      scope,
      "Black-box intervention panel",
      "The model sees a modified recovery context and chooses named actions. Matched controls preserve the checkpoint, work order and hidden state. In the permutation experiment each menu order is a single case.",
    );
    table(
      intro,
      "Black-box evaluation coverage",
      ["Quantity", "Count"],
      Object.entries(b.coverage ?? {}).map(([k, v]) => [title(k), v]),
    );
    const forest = panel(
      ctx.main,
      scope,
      "Paired black-box effects",
      "Each point subtracts the control rate from the intervention rate. Wording variants use their matched neutral sentence as the control. Small cell sizes make these differences descriptive.",
    );
    const selections = control(forest),
      render = el("div");
    forest.append(render);
    const variants = b.variants ?? [];
    const ids = uniq(variants.flatMap((r) => Object.keys(r.by_model ?? {})));
    const families = uniq(variants.map((r) => r.family));
    let checkpoint = ids[0],
      family = families.includes("paraphrase") ? "paraphrase" : families[0],
      measure = "action:inspect";
    const firstActions = uniq(
      variants.flatMap((v) => Object.values(v.by_model).flatMap((r) => Object.keys(r.first_actions))),
    ).sort();
    if (families.includes(ctx.params.get("family"))) family = ctx.params.get("family");
    const requestedOutcome = ctx.params.get("outcome");
    if (firstActions.includes(requestedOutcome?.slice(7)) && requestedOutcome.startsWith("action:"))
      measure = requestedOutcome;
    function plot() {
      render.replaceChildren();
      const rows = variants
        .filter((r) => r.family === family)
        .map((r) => {
          const stats = r.by_model[checkpoint];
          const isAction = measure.startsWith("action:");
          const metric = isAction ? stats.first_actions[measure.slice(7)] : stats[measure];
          // Absent first-action categories represent zero in both arms of a scored row.
          const m = metric ?? (isAction ? { control: 0, treatment: 0, n: stats.n, delta_pp: 0 } : null);
          return {
            group: r.id,
            series: title(r.family),
            value: m?.delta_pp,
            basis:
              r.label +
              " · control " +
              r.control +
              " · " +
              (m ? m.control + "/" + m.n + " to " + m.treatment + "/" + m.n : "unscored"),
          };
        });
      dots(
        render,
        "Intervention minus matched control",
        "Dots are paired percentage-point differences. Each row identifies the named control and both event counts.",
        rows,
        { unit: " pp" },
      );
    }
    if (ids.length && families.length) {
      selector(
        selections,
        "Model",
        ids.map((k) => [k, model(k)]),
        checkpoint,
        (v) => {
          checkpoint = v;
          plot();
        },
      );
      selector(selections, "Intervention family", families, family, (v) => {
        family = v;
        plot();
      });
      selector(
        selections,
        "Outcome",
        [
          ...firstActions.map((action) => ["action:" + action, "First action · " + title(action)]),
          ["submitted", "Submitted"],
          ["exact_state", "Exact state"],
          ["passed", "Exact + submitted"],
        ],
        measure,
        (v) => {
          measure = v;
          plot();
        },
      );
      plot();
    } else empty(render);
    const injection = panel(
      ctx.main,
      scope,
      "Instruction-conflict compliance",
      "A prior-worker note or a tool observation suggested submission. The measured behavior is submission, so direction, placement and whether the agent saw the note matter.",
    );
    const points = [];
    for (const v of variants.filter((v) => v.family === "instruction_conflict")) {
      for (const [k, stats] of Object.entries(v.by_model)) {
        const prior = v.id === "handoff_note";
        const m = prior ? stats.first_actions.submit : stats.submit_after_inspect;
        const n = m?.n ?? (prior ? stats.n : 0);
        for (const side of ["control", "treatment"])
          points.push({
            group: model(k) + " · " + v.id,
            series: side === "control" ? "Matched control" : "Immediate-submit note",
            value: n ? (100 * (m?.[side] ?? 0)) / n : null,
            basis:
              (n ? (m?.[side] ?? 0) + "/" + n : "no paired exposure") +
              " · " +
              (prior ? "first decision" : "next action after inspection"),
          });
      }
    }
    bars(
      injection,
      "Compliance with the immediate-submit note",
      "Percent choosing immediate submission at the designated decision. Voluntary and supplied inspections have different exposure denominators.",
      points,
      { max: 100, unit: "%" },
    );
    const perm = panel(
      ctx.main,
      scope,
      "Menu permutations",
      "These cells test whether ordering the same named actions differently changes the first decision and final verdict.",
    );
    perm.dataset.section = "permutations";
    const permRows = b.permutations ?? [];
    const orderGroups = b.permutation_summaries ?? [];
    if (orderGroups.length) {
      table(
        perm,
        "Permutation results grouped by first menu entry",
        [
          "Model",
          "Task",
          "First menu entry",
          "Orders",
          "Selected first entry",
          "Submitted",
          "Exact state",
          "Exact + submitted",
        ],
        orderGroups.map((r) => [
          model(r.model),
          title(r.task),
          title(r.first_menu_entry),
          r.orders,
          r.chose_first_entry,
          r.submitted,
          r.exact_state,
          r.passed,
        ]),
      );
    }
    chartData(
      perm,
      "Individual menu order trials",
      ["Model", "Task", "Menu order", "First action", "Submitted", "Exact state", "Exact + submitted", "N"],
      permRows.map((r) => [
        model(r.model),
        r.task,
        r.menu.join(" / "),
        r.first_action,
        r.submitted,
        r.exact_state,
        r.passed,
        r.n,
      ]),
    );
  }

  function whitebox(w) {
    const ids = w.models ?? [];
    const fields = (key) => ids.flatMap((m) => (m[key] ?? []).map((r) => ({ ...r, model: m.id })));
    const audit = panel(
      ctx.main,
      scope,
      "Original-weight comparison",
      "The activation measurements use original weights and a different inference implementation. This agreement check measures how often the held-out prefixes reproduce the quantized archive.",
    );
    table(
      audit,
      "Held-out agreement",
      [
        "Model",
        "Exact replies / tested",
        "Matched valid actions / jointly valid",
        "Original-weight invalid",
        "GGUF invalid",
        "Top next-token matches / tested",
        "Mean absolute P(inspect first token) difference",
      ],
      ids.map((m) => {
        const a = m.agreement ?? {};
        return [
          model(m.id),
          a.exact_replies + "/" + a.total,
          a.matched_actions + "/" + a.paired_valid,
          a.hf_invalid,
          a.gguf_invalid,
          a.first_token_matches + "/" + a.total,
          a.inspect_mean_abs_probability_difference,
        ];
      }),
    );
    const lens = panel(
      ctx.main,
      scope,
      "Layerwise logit lens",
      "Apply the final norm and output head to each block's last-prompt-token residual. Compare how rankings of menu first tokens and the full vocabulary change across blocks.",
    );
    perModel(
      lens,
      fields("lens"),
      (out, rs, key) => {
        const measures = {
          agreement: ["final_layer_agreement", "n", "Final-layer agreement"],
          archived: ["archived_action_agreement", "archived_action_n", "Archived valid action"],
          reference: ["reference_action_agreement", "reference_action_n", "Canonical next action"],
          margin: ["mean_margin", "n", "Top-two menu margin"],
          vocabFinal: ["vocab_final_agreement", "n", "Full-vocabulary final-layer agreement"],
          vocabMenu: ["vocab_top_is_menu_token_rate", "n", "Full-vocabulary leader is a menu token"],
          vocabInspect: [
            "mean_vocab_inspect_token_probability",
            "n",
            "Full-vocabulary probability of the inspect token",
          ],
        };
        const [field, denominator, label] = measures[key];
        const margin = key === "margin";
        const vocab = key.startsWith("vocab");
        const vocabAlt = {
          vocabFinal:
            "Percent of prefixes where the highest-scoring token in the full vocabulary matches the final layer's leading token.",
          vocabMenu:
            "Percent of prefixes where the highest-scoring token in the full vocabulary begins a legal menu action.",
          vocabInspect:
            "Mean full-vocabulary probability assigned to the first token of inspect, expressed as a percent.",
        };
        lines(
          out,
          vocab ? "Layerwise full-vocabulary readout" : "Layerwise action-token readout",
          vocab
            ? vocabAlt[key]
            : margin
              ? "Mean difference between the two largest action-token logits by block."
              : "Percent of eligible prefixes whose leading menu token matches the selected reference. A token-level match does not guarantee generation of the complete action.",
          rs.map((r) => ({
            x: r.layer,
            series: label,
            value: r[field] == null ? null : r[field] * (margin ? 1 : 100),
            basis: r[denominator] + " eligible prefixes",
          })),
          { unit: margin ? "" : "%" },
        );
        if (vocab) {
          chartData(
            out,
            "Layerwise leading vocabulary tokens",
            ["Block", "Token ID", "Decoded token", "Prefixes", "Total"],
            rs.flatMap((r) => r.vocab_top_tokens.map((t) => [r.layer, t.id, JSON.stringify(t.text), t.count, r.n])),
          );
        } else {
          chartData(
            out,
            "Layerwise leading menu tokens",
            ["Block", "Top action token", "Prefixes", "Total"],
            rs.flatMap((r) => Object.entries(r.top_action_counts).map(([a, n]) => [r.layer, a, n, r.n])),
          );
        }
      },
      {
        name: "Readout",
        choices: [
          ["agreement", "Agreement with final layer"],
          ["archived", "Agreement with archived action"],
          ["reference", "Agreement with canonical next action"],
          ["margin", "Top-two menu logit margin"],
          ["vocabFinal", "Full vocabulary · final-layer agreement"],
          ["vocabMenu", "Full vocabulary · leader is a menu token"],
          ["vocabInspect", "Full vocabulary · inspect token probability"],
        ],
      },
    );

    const linear = panel(
      ctx.main,
      scope,
      "Held-out linear probe accuracy",
      "A fixed classifier is trained on three seeds and tested on the held-out seed. Shuffling training labels supplies a control. Decodability alone does not establish causal use.",
    );
    const testRows = fields("probes"),
      targets = uniq(testRows.map((r) => r.target));
    if (targets.length)
      perModel(
        linear,
        testRows,
        (out, rs, key) => {
          const rows = rs
            .filter((r) => r.target === key)
            .flatMap((r) =>
              [
                ["accuracy", "True labels"],
                ["shuffled_accuracy", "Shuffled labels"],
                ["majority_accuracy", "Training majority"],
              ].map(([field, label]) => ({
                x: r.layer,
                series: label,
                value: r[field] == null ? null : 100 * r[field],
                basis: r.train_n + " train, " + r.test_n + " test",
              })),
            );
          lines(
            out,
            "Held-out probe accuracy by block",
            "Lines show percent correct for each training-label condition, with the majority-class reference.",
            rows,
            { unit: "%" },
          );
        },
        { name: "Target", choices: targets.map((t) => [t, title(t)]) },
      );
    else empty(linear);

    const attention = panel(
      ctx.main,
      scope,
      "Attention to instructions and observations",
      "The value is head-averaged attention mass on the span at the decision position. The uniform baseline adjusts for token count. Only contexts containing a span contribute.",
    );
    const attentionRows = fields("attention"),
      spans = uniq(attentionRows.map((r) => r.span));
    if (spans.length)
      perModel(
        attention,
        attentionRows,
        (out, rs, span) => {
          const rows = rs
            .filter((r) => r.span === span)
            .flatMap((r) =>
              [
                ["mean_mass", "Observed attention"],
                ["mean_uniform_mass", "Uniform length baseline"],
              ].map(([key, label]) => ({ x: r.layer, series: label, value: 100 * r[key], basis: r.n + " contexts" })),
            );
          lines(
            out,
            "Attention mass by layer",
            "Percent attention on the selected text span at the prompt's final position.",
            rows,
            { unit: "%" },
          );
        },
        { name: "Span", choices: spans.map((s) => [s, title(s)]) },
      );
    else empty(attention);

    const patch = panel(
      ctx.main,
      scope,
      "Activation patching",
      "Copy one component at one block from the verify-first donor into the paired generic prefix. Restricted first-token transfer and full-action transfer have separate denominators.",
    );
    perModel(
      patch,
      fields("patching"),
      (out, rs, metric) => {
        const rows = rs.map((r) => {
          let value, n, info;
          if (metric === "margin") {
            value = r.mean_delta_margin;
            n = r.discordant_leaders;
            info = "discordant token leaders";
          } else if (metric === "full") {
            n = r.full_reply_pairs;
            value = n ? (100 * r.moved_to_donor_action) / n : null;
            info = "valid discordant actions";
          } else {
            n = r.discordant_leaders;
            value = n ? (100 * r.moved_to_donor) / n : null;
            info = "discordant token leaders";
          }
          return { x: r.layer, series: title(r.component), value, basis: n + " " + info };
        });
        lines(
          out,
          "Patched decision readout by layer and component",
          metric === "margin"
            ? "Mean donor-versus-recipient logit margin change."
            : "Percent of eligible pairs that moved to the donor token or action. See the selected readout and case counts.",
          rows,
          { unit: metric === "margin" ? "" : "%" },
        );
      },
      {
        name: "Readout",
        choices: [
          ["margin", "Donor margin change"],
          ["token", "Top-token transfer"],
          ["full", "Full-action transfer"],
        ],
      },
    );

    const steer = panel(
      ctx.main,
      scope,
      "Steering intervention",
      "Inject the learned direction once at the generic prompt's last token, then execute the model's subsequent actions in a fresh SQLite episode. The zero-dose condition is run on the same held-out fixtures as the negative and positive coefficients.",
    );
    perModel(steer, fields("steering"), (out, rs) => {
      const rows = rs.flatMap((r) =>
        [
          ["inspect_first", "Inspected first"],
          ["submitted", "Submitted"],
          ["exact_state", "Exact state"],
          ["passed", "Exact + submitted"],
        ].map(([key, label]) => ({
          x: r.coefficient,
          series: label,
          value: r.n ? (100 * r[key]) / r.n : null,
          basis: r[key] + "/" + r.n + " · block " + r.layer,
        })),
      );
      lines(
        out,
        "Steering dose and episode outcomes",
        "Dots show observed rates at each tested coefficient. Lines connect those observations and do not estimate outcomes at intermediate coefficients.",
        rows,
        { unit: "%" },
      );
    });
  }
  if (black?.variants) blackbox(black);
  else empty(panel(ctx.main, scope, "Black-box probes"), "No measured black-box panel is included in this release.");
  if (white?.models?.length) whitebox(white);
  else
    empty(panel(ctx.main, scope, "White-box probes"), "No measured original-weight panel is included in this release.");
  const limits = panel(
    ctx.main,
    scope,
    "Interpretation and provenance",
    "The panel uses a small, selected set of synthetic work orders. Interventions reuse contexts and cases. Original-weight and quantized runs can diverge. Attention, linear probes and token readouts require distinct interpretations.",
  );
  const refs = el("div", null, "refs");
  refs.append(link("Download probe summaries", "data/probes.json"), link("Methods and source code", "#methods"));
  limits.append(refs);
};
