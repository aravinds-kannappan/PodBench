/* Local, dependency-free plotting. Every graphic has a text description, numerical table and CSV. */
window.PB = (() => {
  "use strict";

  const palette = Array.from({ length: 9 }, (_, index) => "var(--series-" + (index + 1) + ")");
  const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });
  function text(v) {
    if (v == null) return "Unobserved";
    if (typeof v !== "number") return String(v);
    return v !== 0 && Math.abs(v) < 0.001 ? v.toExponential(2) : fmt.format(v);
  }
  const pct = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });
  const percent = (n, d) => (d ? pct.format(n / d) : "N/A");
  const uniq = (items) => [...new Set(items)];
  const title = (s) => String(s).replaceAll("_", " ");
  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = text(value);
    if (className) node.className = className;
    return node;
  };
  function link(label, href, cls) {
    const node = el("a", label, cls);
    node.href = href;
    return node;
  }
  function panel(target, scope, name, description) {
    const box = el("section", null, "panel");
    const header = el("div", null, "panel-head");
    const badge = el(
      "span",
      scope === "frozen" ? "Frozen (preregistered)" : "Exploratory (not preregistered)",
      "badge " + scope,
    );
    header.append(el("h2", name), badge);
    box.append(header);
    if (description) box.append(el("p", description, "description"));
    target.append(box);
    return box;
  }
  function selector(target, label, choices, value, callback) {
    const wrapper = el("label", label);
    const select = el("select");
    select.setAttribute("aria-label", label);
    for (const item of choices) {
      const [key, name] = Array.isArray(item) ? item : [item, title(item)];
      select.add(new Option(name, key));
    }
    if ([...select.options].some((o) => o.value === String(value))) select.value = value;
    select.addEventListener("change", () => callback(select.value));
    wrapper.append(select);
    target.append(wrapper);
    return select;
  }
  const empty = (target, message) =>
    target.append(el("p", message || "No observations match these settings.", "empty"));
  function table(target, name, headings, rows) {
    const wrap = el("div", null, "table-wrap");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", name + " table");
    wrap.tabIndex = 0;
    const result = el("table");
    result.append(el("caption", name, "sr"));
    const head = result.createTHead().insertRow();
    headings.forEach((s) => {
      const th = el("th", s);
      th.scope = "col";
      head.append(th);
    });
    const body = result.createTBody();
    for (const values of rows) {
      const tr = body.insertRow();
      values.forEach((value, i) => {
        const cell = el(i ? "td" : "th");
        if (!i) cell.scope = "row";
        if (value instanceof Node) cell.append(value);
        else cell.textContent = text(value);
        if (typeof value === "number") cell.className = "num";
        tr.append(cell);
      });
    }
    wrap.append(result);
    target.append(wrap);
    return result;
  }
  function csvDownload(target, name, headings, rows) {
    const download = el("button", "Download chart CSV", "button");
    download.type = "button";
    download.addEventListener("click", () => {
      const cell = (val) => {
        let s = val == null ? "" : String(val);
        if (typeof val === "string" && /^[=+@-]/.test(s)) s = "'" + s;
        return '"' + s.replaceAll('"', '""') + '"';
      };
      const csv = [headings, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = link("CSV", url);
      anchor.download = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    target.append(download);
  }
  function chartData(target, name, headings, rows, open = false) {
    const details = el("details", null, "chart-data");
    details.open = open;
    details.append(el("summary", "View values and download CSV"));
    table(details, name, headings, rows);
    csvDownload(details, name, headings, rows);
    target.append(details);
  }
  function svgEl(tag, attrs, content) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
    if (content != null) n.textContent = content;
    return n;
  }
  function figure(target, name, alt, height, width = 850) {
    const fig = el("figure", null, "chart");
    const canvas = el("div", null, "canvas");
    const svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, role: "img", "aria-label": name + ". " + alt });
    svg.append(svgEl("title", {}, name), svgEl("desc", {}, alt));
    canvas.append(svg);
    fig.append(canvas, el("figcaption", alt));
    target.append(fig);
    return { svg, fig, width, height };
  }
  function legend(target, series) {
    const widget = el("div", null, "legend");
    series.forEach((name, i) => {
      const s = el("span");
      const swatch = el("i");
      swatch.style.background = palette[i % palette.length];
      s.append(swatch, document.createTextNode(name));
      widget.append(s);
    });
    target.prepend(widget);
  }
  function xAxis(svg, min, max, left, right, top, bottom, unit = "") {
    const at = (v) => left + ((right - left) * (v - min)) / (max - min || 1);
    for (let i = 0; i < 5; i++) {
      const v = min + ((max - min) * i) / 4;
      svg.append(
        svgEl("line", { x1: at(v), x2: at(v), y1: top, y2: bottom, stroke: "var(--grid)", "stroke-width": 0.8 }),
      );
      svg.append(svgEl("text", { x: at(v), y: top - 8, "text-anchor": "middle" }, fmt.format(v) + unit));
    }
    if (min < 0 && max > 0)
      svg.append(svgEl("line", { x1: at(0), x2: at(0), y1: top, y2: bottom, stroke: "var(--axis)" }));
    return at;
  }
  function mark(svg, tag, attrs, caption) {
    const shape = svgEl(tag, attrs);
    shape.append(svgEl("title", {}, caption));
    svg.append(shape);
  }
  function chartTable(target, name, rows, headings = ["Group", "Series", "Value", "Basis"]) {
    chartData(
      target,
      name,
      headings,
      rows.map((r) => [r.group, r.series, r.value, r.basis]),
    );
  }
  function showZeroCounts(target, name, rows, byTurn = false) {
    const scored = rows.filter((r) => Number.isFinite(r.value));
    if (!scored.length || scored.some((r) => r.value !== 0 || r.low || r.high)) return false;
    target.append(el("p", "Every observed value in this comparison is zero.", "diagnostic"));
    chartData(
      target,
      name,
      [byTurn ? "X" : "Group", "Series", "Value", "Basis"],
      rows.map((r) => [byTurn ? r.x : r.group, r.series, r.value, r.basis]),
      true,
    );
    return true;
  }
  function bars(target, name, alt, rows, options = {}) {
    if (!rows.length) return empty(target);
    if (showZeroCounts(target, name, rows)) return;
    const groups = uniq(rows.map((r) => r.group));
    const series = uniq(rows.map((r) => r.series));
    const rowHeight = options.stack ? 37 : Math.max(34, series.length * 16 + 14);
    const { svg, fig } = figure(target, name, alt, 39 + groups.length * rowHeight);
    const minimum = Math.min(0, ...rows.map((r) => r.value ?? 0));
    const maximum =
      options.max ??
      Math.max(
        1,
        ...groups.map((g) => {
          const vals = rows.filter((r) => r.group === g).map((r) => r.value ?? 0);
          return options.stack ? vals.reduce((a, b) => a + b, 0) : Math.max(...vals);
        }),
      );
    const left = 214;
    const at = xAxis(svg, minimum, maximum, left, 815, 29, 29 + groups.length * rowHeight, options.unit);
    for (const [index, group] of groups.entries()) {
      const y = 31 + index * rowHeight;
      svg.append(svgEl("text", { x: 5, y: y + rowHeight / 2 + 2 }, group));
      let offset = 0;
      for (const r of rows.filter((r) => r.group === group && Number.isFinite(r.value))) {
        const i = series.indexOf(r.series);
        const start = options.stack ? offset : 0;
        mark(
          svg,
          "rect",
          {
            x: Math.min(at(start), at(start + r.value)),
            y: y + (options.stack ? 8 : i * 16 + 2),
            width: Math.abs(at(start + r.value) - at(start)),
            height: options.stack ? 17 : 12,
            rx: 2,
            fill: palette[i % palette.length],
          },
          group + " · " + r.series + " · " + text(r.value) + " " + (r.basis ?? ""),
        );
        offset += r.value;
      }
    }
    legend(fig, series);
    chartTable(target, name, rows);
  }
  function dots(target, name, alt, rows, { unit = "", symmetric = true } = {}) {
    if (showZeroCounts(target, name, rows)) return;
    const groups = uniq(rows.map((r) => r.group));
    const valid = rows.filter((r) => Number.isFinite(r.value));
    if (!valid.length) {
      empty(target, "No scored points for this comparison.");
      chartTable(target, name, rows);
      return;
    }
    const series = uniq(valid.map((r) => r.series));
    const { svg, fig } = figure(target, name, alt, groups.length * 32 + 42);
    const extent = Math.max(
      0.01,
      ...valid.flatMap((r) => [r.value, r.low ?? r.value, r.high ?? r.value]).map(Math.abs),
    );
    const at = xAxis(svg, symmetric ? -extent : 0, extent, 222, 817, 30, 32 + groups.length * 32, unit);
    groups.forEach((g, i) => {
      const y = 45 + i * 32;
      svg.append(svgEl("text", { x: 4, y: y + 3 }, g));
      const points = valid.filter((r) => r.group === g);
      points.forEach((r, j) => {
        const cy = y + (points.length > 1 ? ((j % 5) - 2) * 2.5 : 0);
        const color = palette[series.indexOf(r.series) % palette.length];
        if (Number.isFinite(r.low) && Number.isFinite(r.high) && r.high > r.low) {
          svg.append(
            svgEl("line", { x1: at(r.low), x2: at(r.high), y1: cy, y2: cy, stroke: color, "stroke-width": 2 }),
          );
        }
        mark(
          svg,
          "circle",
          { cx: at(r.value), cy, r: 4.1, fill: color, opacity: 0.9 },
          g + " · " + r.series + " · " + text(r.value) + " " + (r.basis ?? ""),
        );
      });
    });
    legend(fig, series);
    chartData(
      target,
      name,
      ["Group", "Series", "Estimate", "Low", "High", "Basis"],
      rows.map((r) => [r.group, r.series, r.value, r.low, r.high, r.basis]),
    );
  }
  function lines(target, name, alt, rows, { unit = "", zero = true } = {}) {
    if (showZeroCounts(target, name, rows, true)) return;
    const valid = rows.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.value));
    if (!valid.length) {
      empty(target, "No eligible recorded measurements for this comparison.");
      chartData(
        target,
        name,
        ["X", "Series", "Value", "Basis"],
        rows.map((r) => [r.x, r.series, r.value, r.basis]),
      );
      return;
    }
    const series = uniq(valid.map((r) => r.series));
    const xs = uniq(valid.map((r) => r.x)).sort((a, b) => a - b);
    const ymin = Math.min(zero ? 0 : Infinity, ...valid.map((r) => r.value));
    const ymax = Math.max(...valid.map((r) => r.value));
    const atX = (x) => 76 + (710 * (x - xs[0])) / (xs.at(-1) - xs[0] || 1);
    const atY = (v) => 220 - (184 * (v - ymin)) / (ymax - ymin || 1);
    const { svg, fig } = figure(target, name, alt, 260);
    for (let i = 0; i <= 4; i++) {
      const val = ymin + ((ymax - ymin || 1) * i) / 4,
        y = 220 - (184 * i) / 4;
      svg.append(
        svgEl("line", { x1: 76, x2: 786, y1: y, y2: y, stroke: "var(--grid)" }),
        svgEl("text", { x: 66, y: y + 4, "text-anchor": "end" }, fmt.format(val) + unit),
      );
    }
    const every = Math.max(1, Math.ceil(xs.length / 9));
    xs.filter((_, i) => i % every === 0 || i === xs.length - 1).forEach((x) =>
      svg.append(svgEl("text", { x: atX(x), y: 244, "text-anchor": "middle" }, text(x))),
    );
    series.forEach((s, i) => {
      const pts = valid.filter((r) => r.series === s).sort((a, b) => a.x - b.x);
      const color = palette[i % palette.length];
      svg.append(
        svgEl("polyline", {
          points: pts.map((r) => atX(r.x) + "," + atY(r.value)).join(" "),
          fill: "none",
          stroke: color,
          "stroke-width": 2.2,
        }),
      );
      pts.forEach((r) =>
        mark(
          svg,
          "circle",
          { cx: atX(r.x), cy: atY(r.value), r: 3.5, fill: color },
          s + " · " + r.x + " · " + text(r.value) + " " + (r.basis ?? ""),
        ),
      );
    });
    legend(fig, series);
    chartData(
      target,
      name,
      ["X", "Series", "Value", "Basis"],
      rows.map((r) => [r.x, r.series, r.value, r.basis]),
    );
  }
  function heat(target, name, alt, rows) {
    if (!rows.length) return empty(target);
    const groups = uniq(rows.map((r) => r.group)),
      actions = uniq(rows.map((r) => r.series));
    const fig = el("figure", null, "chart");
    const t = table(
      fig,
      name,
      ["Setting", ...actions],
      groups.map((g) => [
        g,
        ...actions.map((a) => {
          const r = rows.find((s) => s.group === g && s.series === a);
          return r ? r.basis : "0";
        }),
      ]),
    );
    [...t.tBodies[0].rows].forEach((tr, i) =>
      [...tr.cells].slice(1).forEach((cell, j) => {
        const record = rows.find((r) => r.group === groups[i] && r.series === actions[j]);
        const val = record?.value ?? 0;
        cell.className = "heat";
        cell.dataset.shade = val === 0 ? "zero" : val < 0.25 ? "low" : val < 0.6 ? "mid" : "high";
      }),
    );
    fig.append(el("figcaption", alt));
    target.append(fig);
    chartTable(target, name, rows);
  }
  function flow(target, name, alt, rows) {
    if (!rows.length) return empty(target);
    const cols = ["first", "second", "terminal"];
    const stages = cols.map((key) => uniq(rows.map((r) => String(r[key]))));
    const height = Math.max(285, Math.max(...stages.map((s) => s.length)) * 35 + 65);
    const { svg } = figure(target, name, alt, height);
    const xs = [10, 323, 638],
      width = 174,
      total = rows.reduce((s, r) => s + r.count, 0);
    const y = (stage, key) => 49 + ((height - 75) * (stages[stage].indexOf(String(key)) + 0.5)) / stages[stage].length;
    for (let i = 0; i < 2; i++) {
      const edges = new Map();
      rows.forEach((r) => {
        const key = JSON.stringify([r[cols[i]], r[cols[i + 1]]]);
        edges.set(key, (edges.get(key) || 0) + r.count);
      });
      for (const [key, count] of edges) {
        const [a, b] = JSON.parse(key),
          x1 = xs[i] + width,
          x2 = xs[i + 1],
          mid = (x1 + x2) / 2,
          y1 = y(i, a),
          y2 = y(i + 1, b);
        mark(
          svg,
          "path",
          {
            d: `M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
            stroke: palette[i],
            fill: "none",
            opacity: 0.86,
            "stroke-width": (28 * count) / total,
          },
          a + " to " + b + ": " + count,
        );
      }
    }
    stages.forEach((stage, i) => {
      svg.append(
        svgEl("text", { x: xs[i], y: 25, class: "value" }, ["First decision", "Second decision", "Terminal result"][i]),
      );
      stage.forEach((v) => {
        const cy = y(i, v);
        svg.append(svgEl("rect", { x: xs[i], y: cy - 12, width, height: 24, rx: 4, fill: "var(--node-bg)" }));
        const label = svgEl("text", { x: xs[i] + 6, y: cy + 4 }, title(v).slice(0, 24));
        label.append(svgEl("title", {}, title(v)));
        svg.append(label);
      });
    });
    chartData(
      target,
      name,
      ["First decision", "Second decision", "Terminal result", "Episodes"],
      rows.map((r) => [r.first, r.second, r.terminal, r.count]),
    );
  }
  return {
    el,
    link,
    panel,
    selector,
    empty,
    table,
    csvDownload,
    chartData,
    bars,
    dots,
    lines,
    heat,
    flow,
    fmt,
    text,
    percent,
    title,
    uniq,
  };
})();
