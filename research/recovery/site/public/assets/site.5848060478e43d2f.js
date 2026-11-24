(() => {
  "use strict";
  const { el, link, panel, table, title } = PB;
  const repo = "https://github.com/aravinds-kannappan/PodBench";
  const ledger = repo + "/tree/recovery-v1.0.0/research/recovery";
  const mechanism = repo + "/tree/main/research/recovery/mechanism";
  const routes = [
    ["home", "Leaderboard", PBResults.home],
    ["what-changed", "What changed", PBResults.changed],
    ["instruction-explainer", "Instruction explainer", PBResults.instructions],
    ["trajectory", "Trajectory viewer", PBTrajectory],
    ["failure-taxonomy", "Failure taxonomy", PBResults.failures],
    ["probes", "Probes", PBProbes],
    ["expert-review", "Expert review", review],
    ["paper-summary", "Paper summary", paperSummary],
    ["paper", "Full paper", paper],
    ["blog", "Blog", blog],
    ["methods", "Methods & data", methods],
  ];
  const cache = new Map();
  const byId = (id) => document.getElementById(id);
  function url(page, params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ""));
    return "#" + page + (query.size ? "?" + query : "");
  }
  function safePath(path) {
    const base = new URL("./", location.href),
      target = new URL(path, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname))
      throw new Error("Unavailable local file.");
    return target.href;
  }
  async function json(path) {
    const key = safePath(path);
    if (!cache.has(key))
      cache.set(
        key,
        fetch(key)
          .then((response) => {
            if (!response.ok) throw new Error("Unable to load " + path);
            return response.json();
          })
          .catch((error) => {
            cache.delete(key);
            throw error;
          }),
      );
    return cache.get(key);
  }
  function refs(target, links) {
    const items = el("div", null, "refs");
    for (const [label, href] of links) items.append(link(label, href));
    target.append(items);
  }
  function figureFrame(target, path, name) {
    const frame = el("iframe", null, "frame");
    frame.title = name;
    frame.src = safePath(path);
    frame.setAttribute(
      "sandbox",
      "allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation",
    );
    target.append(frame);
  }
  async function review(ctx) {
    ctx.hero(
      "Expert review",
      "Independent reviewers can examine a masked sample, label the observed behavior and export their judgments.",
    );
    const status = await ctx.json("review/agreement.json");
    const box = panel(
      ctx.main,
      "exploratory",
      "Annotation status",
      "Case sampling, masked materials and the rubric are available for independent evaluation. The published agreement summary uses only real submitted annotations.",
    );
    const ready = status.status === "annotations available";
    box.append(el("p", ready ? "Annotations available" : "Awaiting annotations", "diagnostic"));
    table(
      box,
      "Review coverage",
      ["Cases in kit", "Active raters", "Status"],
      [[status.case_count, status.active_raters, status.status]],
    );
    refs(box, [
      ["Open the masked review workspace", "review/index.html"],
      ["Download kit (JSON)", "review/kit.json"],
      ["Download kit (CSV)", "review/kit.csv"],
      ["Agreement data", "review/agreement.json"],
    ]);
    const kit = await ctx.json("review/kit.json");
    const rubric = panel(
      ctx.main,
      "exploratory",
      "Review rubric",
      "Raters see the work order, actions, tool results and database differences. Independent judgments are collected separately from the automatic labels.",
    );
    table(
      rubric,
      "Annotation rubric",
      ["Dimension", "Guidance", "Choices"],
      Object.entries(kit.rubric).map(([k, v]) => [v.title ?? title(k), v.guide, v.choices?.join(" · ")]),
    );
    if (ready) {
      const results = panel(
        ctx.main,
        "exploratory",
        "Agreement and disagreements",
        "Inspect the observed judgments, coverage and agreement denominators for each rubric item.",
      );
      const estimates = [];
      for (const [key, stats] of Object.entries(status.rubric)) {
        const group = kit.rubric[key]?.title ?? title(key);
        for (const pair of stats.pairwise_cohen) {
          estimates.push({
            group,
            series: "Cohen · " + pair.readers.join(" / "),
            value: pair.kappa,
            basis: pair.n + " shared cases · " + pair.status,
          });
        }
        const f = stats.fleiss_complete_panel;
        estimates.push({
          group,
          series: "Fleiss · complete panel",
          value: f.kappa,
          basis: f.n + " shared cases · " + f.status,
        });
      }
      PB.dots(
        results,
        "Inter-rater agreement",
        "Cohen kappa uses jointly rated cases for a reader pair. Fleiss kappa uses cases rated by every active reader. Undefined estimates remain unplotted.",
        estimates,
      );
      const confusion = status.confusion;
      if (confusion.length) {
        const labels = PB.uniq(confusion.flatMap((r) => [r.expert, r.automated])).sort();
        const max = Math.max(...confusion.map((r) => r.count));
        const cells = labels.flatMap((group) =>
          labels.map((series) => {
            const count = confusion.find((r) => r.expert === group && r.automated === series)?.count ?? 0;
            return { group, series, value: count / max, basis: count };
          }),
        );
        results.append(el("h3", "Expert and automated failure labels"));
        PB.heat(
          results,
          "Confusion matrix",
          "Rows are expert labels and columns are automated labels. Each cell shows the number of ratings, with shade scaled to the largest count.",
          cells,
        );
      }
      if (status.disagreements.length)
        table(
          results,
          "Observed disagreements",
          ["Case", "Reader", "Expert", "Automated"],
          status.disagreements.map((r) => [r.case_id, r.reader, r.expert, r.automated]),
        );
      refs(results, [["Review confusion and disagreement records", "review/agreement.json"]]);
    }
  }
  function writingPath(value, fallback) {
    return "writing/" + String(value || fallback).replace(/^\.\//, "");
  }
  async function paperSummary(ctx) {
    ctx.hero("Paper summary", "Read the executive summary alongside the complete manuscript and supporting artifacts.");
    const index = await ctx.json("writing/index.json"),
      p = index.paper;
    const b = panel(
      ctx.main,
      "exploratory",
      p.title,
      "The manuscript distinguishes the frozen recovery test from the subsequent exploratory analyses. Source figures and transcripts remain available for inspection.",
    );
    const file = writingPath(p.summary_html ?? p.executive_summary_html, "summary.html");
    refs(b, [
      ["Open standalone summary", file],
      ["Read the full paper", "#paper"],
      ["Executive summary Markdown", writingPath(p.executive_summary, "summary.md")],
    ]);
    figureFrame(b, file, "Recovery study executive summary");
  }
  async function paper(ctx) {
    ctx.hero("Full paper", "Read the complete manuscript, download the typeset paper or inspect its source.");
    const { paper: p } = await ctx.json("writing/index.json");
    const b = panel(
      ctx.main,
      "exploratory",
      p.title,
      p.status ? "The manuscript is currently marked " + p.status + "." : "Research manuscript",
    );
    const file = writingPath(p.html, "paper.html");
    refs(b, [
      ["Open standalone paper", file],
      ["Download PDF", writingPath(p.pdf, "paper.pdf")],
      ["Download Markdown", writingPath(p.markdown, "paper.md")],
      ["Study methods", "#methods"],
    ]);
    figureFrame(b, file, p.title);
  }
  async function blog(ctx) {
    ctx.hero("Research blog", "Read the research notes, worked examples and updates accompanying the recovery study.");
    const index = await ctx.json("writing/index.json");
    const b = panel(ctx.main, "exploratory", "Posts", "Publication status is shown for each article.");
    const selected = index.posts.find((p) => p.slug === ctx.params.get("post"));
    if (selected) {
      b.append(
        el("h3", selected.title),
        el("p", selected.summary),
        el("p", selected.status + " · " + selected.date, "note"),
      );
      const path = writingPath(selected.html, "blog/" + selected.slug + ".html");
      refs(b, [
        ["All posts", "#blog"],
        ["Open standalone post", path],
        ["Markdown source", writingPath(selected.markdown, "blog/" + selected.slug + ".md")],
      ]);
      figureFrame(b, path, selected.title);
    } else {
      const cards = el("div", null, "cards");
      b.append(cards);
      for (const post of index.posts) {
        const card = el("article", null, "card");
        card.append(
          el("p", post.status + " · " + post.date, "tag"),
          el("h3", post.title),
          el("p", post.summary),
          link("Read post", url("blog", { post: post.slug })),
        );
        cards.append(card);
      }
      refs(b, [
        ["RSS feed", "writing/blog/feed.xml"],
        ["Standalone archive", "writing/blog/index.html"],
      ]);
    }
  }
  async function methods(ctx) {
    ctx.hero(
      "Methods, limitations and data",
      "Trace a result back to its protocol, episode, scoring code and generated public data.",
    );
    const f = await ctx.data("frozen");
    const frozen = panel(
      ctx.main,
      "frozen",
      "Prospective recovery protocol",
      "The protocol was committed before this evaluation. The frozen label denotes that repository timestamp. There was no independent preregistration registry.",
    );
    table(
      frozen,
      "Original study design",
      ["Design component", "Coverage"],
      [
        ["Checkpoints", f.models.map(PBResults.model).join(" and ")],
        ["Task families", f.families.map(title).join(", ")],
        ["Scheduled episodes", f.totals.scheduled],
        ["Recorded episodes", f.totals.recorded],
        ["Decision budget", "Five per episode"],
        ["Primary outcome", "Exact SQLite target state and explicit submission"],
        ["Matched factors", "Model, task, seed, prior commit outcome and menu order"],
      ],
    );
    frozen.append(
      el(
        "p",
        "The finite task set, four seeds per family, two quantized checkpoints, fixed menu, deterministic decoding and short turn budget limit generalization. A zero event count here does not estimate a universal failure rate.",
        "note",
      ),
    );
    refs(frozen, [
      ["Frozen protocol", repo + "/blob/f4ef7fdf31b98fa95046f1ff5ca6461b4a192271/research/recovery/PROTOCOL.md"],
      ["Frozen release", repo + "/releases/tag/recovery-v1.0.0"],
      ["Frozen summary JSON", "data/frozen.json"],
      ["Raw episode journal", ledger.replace("/tree/", "/blob/") + "/episodes.jsonl"],
    ]);
    const exploratory = panel(
      ctx.main,
      "exploratory",
      "Evidence from replay and interventions",
      "Exact SQLite replay reconstructs actions, tool results and terminal states. New analyses condition on archival decisions or use additional, explicitly controlled continuations.",
    );
    table(
      exploratory,
      "Exploratory measures and limits",
      ["Measure", "What it can establish", "Limit"],
      [
        [
          "Menu score",
          "Likelihood of an allowed action under the scoring convention",
          "Normalized menu probabilities exclude free-form replies.",
        ],
        [
          "Reachability",
          "Existence of a legal completion within the remaining horizon",
          "The evaluator knows the database state and the target.",
        ],
        [
          "Forced continuation",
          "Measured behavior after replacing a particular next action",
          "Eligible cases change with turn and policy.",
        ],
        [
          "Observation swap",
          "Sensitivity at a fixed prefix to substituting tool evidence",
          "Conditional scores do not establish end-to-end recovery.",
        ],
        [
          "Black-box contrast",
          "Response to a matched prompt or menu intervention",
          "The selected cases are sparse and share prefixes.",
        ],
        [
          "White-box readout",
          "Information accessible to a specified readout at a layer",
          "Attention or probe accuracy alone does not show causal use.",
        ],
        [
          "Activation intervention",
          "Local response to an activation patch or steering vector",
          "Original weights and runtime can disagree with the quantized archive.",
        ],
        [
          "Expert review",
          "Independent interpretation of masked episode details",
          "Agreement requires overlapping, completed human annotations.",
        ],
      ],
    );
    refs(exploratory, [
      ["Analysis summary JSON", "data/summary.json"],
      ["Episode index", "data/episodes.json"],
      ["Probe results", "data/probes.json"],
      ["Data checksums", "data/integrity.json"],
      [
        "Qwen decision residuals (NPZ)",
        mechanism.replace("/tree/", "/blob/") + "/whitebox/records/qwen2.5-0.5b/decision-residuals.npz",
      ],
      [
        "SmolLM decision residuals (NPZ)",
        mechanism.replace("/tree/", "/blob/") + "/whitebox/records/smollm2-360m/decision-residuals.npz",
      ],
      ["Code and raw artifacts", mechanism],
      ["Review materials", "review/index.html"],
    ]);
    const credit = panel(
      ctx.main,
      "exploratory",
      "Reproduction and attribution",
      "The archive includes collection settings, model revisions, prompts, output tokens and replay code. The repository documents how to rerun the original verifier and reproduce the mechanism analyses.",
    );
    refs(credit, [
      ["Repository", repo],
      ["Recovery environment", ledger],
      ["Mechanism analyses", mechanism],
      ["Reference leaderboard design", "https://compassionbench.com/tac"],
    ]);
  }
  function buildNav() {
    for (const [i, [id, label]] of routes.entries()) {
      const nav = byId(i < 6 ? "benchmark-nav" : "research-nav");
      const a = link(label, url(id));
      a.dataset.route = id;
      nav.append(a);
      const mobile = a.cloneNode(true);
      byId("all-nav").append(mobile);
    }
  }
  let currentRoute = null;
  async function render() {
    const fragment = location.hash;
    const [slug, query] = fragment.slice(1).replace(/^\//, "").split("?");
    if (slug === "content") return;
    const aliases = {
      review: "expert-review",
      instructions: "instruction-explainer",
      trajectories: "trajectory",
      failures: "failure-taxonomy",
      summary: "paper-summary",
    };
    const id = aliases[slug] ?? (slug || "home");
    const route = routes.find(([key]) => key === id),
      params = new URLSearchParams(query);
    const root = byId("content"),
      main = el("div");
    const oldFocus = document.activeElement;
    const currentSelect = oldFocus?.tagName === "SELECT" ? oldFocus.getAttribute("aria-label") : null;
    const currentButton = oldFocus?.getAttribute("aria-pressed") != null ? oldFocus.textContent : null;
    root.replaceChildren(main);
    root.setAttribute("aria-busy", "true");
    document.querySelector(".mobile-menu").open = false;
    for (const a of document.querySelectorAll("[data-route]")) {
      if (a.dataset.route === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    const changed = currentRoute !== null && currentRoute !== id;
    currentRoute = id;
    const ctx = {
      main,
      params,
      id,
      url,
      json,
      data: (file) => json("data/" + file + ".json"),
      go: (page, par) => {
        location.hash = url(page, par);
      },
      update: (extra) => {
        location.hash = url(id, { ...Object.fromEntries(params), ...extra });
      },
      hero: (name, description, actions = [], home = false) => {
        const h = el("header", null, "hero" + (home ? " home" : ""));
        h.append(el("h1", name), el("p", description, "lede"));
        if (actions.length) {
          const buttons = el("div", null, "actions");
          actions.forEach(([l, href], i) => buttons.append(link(l, href, "pill" + (i ? "" : " primary"))));
          h.append(buttons);
        }
        main.append(h);
        document.title = name + " · PodBench Recovery";
      },
    };
    try {
      if (route) await route[2](ctx);
      else {
        ctx.hero("Page unavailable", "This section is not in the recovery archive.", [["Open leaderboard", "#home"]]);
      }
    } catch (error) {
      const box = el("section", null, "panel");
      box.setAttribute("role", "alert");
      box.append(
        el("h2", "Data unavailable"),
        el("p", "This page could not load a required local artifact. Reload the page or inspect the archive."),
        link("Browse the repository", repo),
      );
      main.append(box);
      console.error(error);
    } finally {
      if (root.firstChild === main) {
        root.dataset.page = id;
        root.dataset.fragment = fragment;
        root.setAttribute("aria-busy", "false");
        if (changed) {
          root.focus({ preventScroll: true });
          window.scrollTo(0, 0);
        }
        if (!changed && (currentSelect || currentButton)) {
          const focus = [...main.querySelectorAll("select,button[aria-pressed]")].find((item) =>
            currentSelect ? item.getAttribute("aria-label") === currentSelect : item.textContent === currentButton,
          );
          focus?.focus({ preventScroll: true });
        }
        if (id === "probes" && params.get("section") === "permutations") {
          main.querySelector('[data-section="permutations"]')?.scrollIntoView({ block: "start" });
        }
        if (id === "trajectory" && params.has("id") && params.has("turn")) {
          main.querySelector("[data-turn-detail]")?.scrollIntoView({ block: "start" });
        }
      }
    }
  }
  document.querySelector(".skip").addEventListener("click", (e) => {
    e.preventDefault();
    byId("content").focus();
  });
  buildNav();
  window.addEventListener("hashchange", render);
  render();
})();
