// Lightweight inline SVG charts. No chart dependency, render on the server.
import React from "react";

export function Sparkline({
  data,
  width = 120,
  height = 28,
  color = "var(--accent)",
  limit,
  fill = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  limit?: number;
  fill?: boolean;
}) {
  if (!data.length) return <svg width={width} height={height} />;
  const max = Math.max(limit ?? 0, ...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * height;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {fill && <path d={area} fill={color} opacity={0.12} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} />
      {limit !== undefined && (
        <line
          x1={0}
          x2={width}
          y1={height - ((limit - min) / span) * height}
          y2={height - ((limit - min) / span) * height}
          stroke="var(--bad)"
          strokeWidth={0.8}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      )}
    </svg>
  );
}

export function AreaChart({
  data,
  labels,
  width = 560,
  height = 160,
  color = "var(--accent-2)",
  yLabel,
}: {
  data: number[];
  labels?: string[];
  width?: number;
  height?: number;
  color?: string;
  yLabel?: string;
}) {
  const pad = { l: 36, r: 8, t: 10, b: 22 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(...data, 1);
  const step = w / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => [pad.l + i * step, pad.t + h - (v / max) * h] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pad.l + w},${pad.t + h} L${pad.l},${pad.t + h} Z`;
  const ticks = 3;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ maxWidth: "100%" }}>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const y = pad.t + (h / ticks) * i;
        const val = Math.round(max - (max / ticks) * i);
        return (
          <g key={i}>
            <line x1={pad.l} x2={pad.l + w} y1={y} y2={y} stroke="var(--border-soft)" strokeWidth={1} />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">
              {val}
            </text>
          </g>
        );
      })}
      <path d={area} fill={color} opacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} />
      {labels &&
        labels.map((lab, i) =>
          i % Math.ceil(labels.length / 6) === 0 ? (
            <text
              key={i}
              x={pad.l + i * step}
              y={height - 6}
              textAnchor="middle"
              fontSize={9}
              fill="var(--text-faint)"
              fontFamily="var(--mono)"
            >
              {lab}
            </text>
          ) : null
        )}
      {yLabel && (
        <text x={pad.l} y={8} fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">
          {yLabel}
        </text>
      )}
    </svg>
  );
}

export function Histogram({
  buckets,
  width = 560,
  height = 150,
}: {
  buckets: number[];
  width?: number;
  height?: number;
}) {
  const pad = { l: 32, r: 8, t: 10, b: 22 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(...buckets, 1);
  const bw = w / buckets.length;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%" }}>
      {buckets.map((v, i) => {
        const bh = (v / max) * h;
        const x = pad.l + i * bw;
        const y = pad.t + h - bh;
        const isTop = i === buckets.length - 1;
        return (
          <g key={i}>
            <rect
              x={x + 2}
              y={y}
              width={bw - 4}
              height={bh}
              rx={2}
              fill={isTop ? "var(--accent)" : "var(--accent-2)"}
              opacity={isTop ? 0.9 : 0.55}
            />
            <text x={x + bw / 2} y={pad.t + h + 13} textAnchor="middle" fontSize={8} fill="var(--text-faint)" fontFamily="var(--mono)">
              {(i / 10).toFixed(1)}
            </text>
            {v > 0 && (
              <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize={9} fill="var(--text-dim)" fontFamily="var(--mono)">
                {v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Scatter({
  points,
  width = 560,
  height = 240,
  xLabel = "cost / run (USD)",
  yLabel = "avg reward",
}: {
  points: { label: string; x: number; y: number; highlight?: boolean }[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
}) {
  const pad = { l: 44, r: 14, t: 14, b: 34 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const xs = points.map((p) => p.x);
  const xMax = Math.max(...xs, 0.0001) * 1.15;
  const yMax = 1; // reward is 0..1
  const px = (x: number) => pad.l + (x / xMax) * w;
  const py = (y: number) => pad.t + h - (y / yMax) * h;

  // Pareto frontier: a point is efficient if no other point is both cheaper
  // (lower x) and better (higher y). Connect the efficient set front-to-back.
  const efficient = points.filter(
    (p) => !points.some((q) => q !== p && q.x <= p.x && q.y >= p.y && (q.x < p.x || q.y > p.y))
  );
  const frontier = [...efficient].sort((a, b) => a.x - b.x);
  const frontierPath = frontier
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`)
    .join(" ");

  const yTicks = 4;
  const xTicks = 4;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%" }}>
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const v = (yMax / yTicks) * i;
        const y = py(v);
        return (
          <g key={`y${i}`}>
            <line x1={pad.l} x2={pad.l + w} y1={y} y2={y} stroke="var(--border-soft)" strokeWidth={1} />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">
              {v.toFixed(1)}
            </text>
          </g>
        );
      })}
      {Array.from({ length: xTicks + 1 }).map((_, i) => {
        const v = (xMax / xTicks) * i;
        const x = px(v);
        return (
          <text key={`x${i}`} x={x} y={height - 18} textAnchor="middle" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">
            {v >= 1 ? `$${v.toFixed(1)}` : `$${v.toFixed(3)}`}
          </text>
        );
      })}
      {frontier.length > 1 && (
        <path d={frontierPath} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.6} />
      )}
      {points.map((p, i) => {
        const eff = efficient.includes(p);
        return (
          <g key={i}>
            <circle
              cx={px(p.x)}
              cy={py(p.y)}
              r={eff ? 6 : 4.5}
              fill={eff ? "var(--accent)" : "var(--accent-2)"}
              opacity={eff ? 0.95 : 0.7}
              stroke="var(--bg)"
              strokeWidth={1}
            />
            <text
              x={px(p.x)}
              y={py(p.y) - 9}
              textAnchor="middle"
              fontSize={9}
              fill={eff ? "var(--accent)" : "var(--text-dim)"}
              fontFamily="var(--mono)"
            >
              {p.label}
            </text>
          </g>
        );
      })}
      <text x={pad.l} y={10} fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">
        {yLabel}
      </text>
      <text x={pad.l + w} y={height - 4} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">
        {xLabel} →
      </text>
    </svg>
  );
}

// Two unit axes (0..1) split into four quadrants by midlines. Used to plot
// capability (x) against trust (y): the top-right quadrant is "capable AND
// trustworthy"; bottom-right is the dangerous one — capable but untrustworthy.
export function QuadrantScatter({
  points,
  width = 560,
  height = 300,
  xLabel = "capability (avg reward) →",
  yLabel = "trust (avg propensity) →",
  threshold = 0.85,
}: {
  points: { label: string; x: number; y: number }[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  threshold?: number;
}) {
  const pad = { l: 46, r: 16, t: 16, b: 36 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const px = (x: number) => pad.l + Math.max(0, Math.min(1, x)) * w;
  const py = (y: number) => pad.t + h - Math.max(0, Math.min(1, y)) * h;
  const ticks = 4;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%" }}>
      {/* danger quadrant: high capability, low trust */}
      <rect x={px(threshold)} y={py(threshold)} width={px(1) - px(threshold)} height={py(0) - py(threshold)} fill="var(--bad)" opacity={0.07} />
      {/* gridlines */}
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = i / ticks;
        return (
          <g key={i}>
            <line x1={pad.l} x2={pad.l + w} y1={py(v)} y2={py(v)} stroke="var(--border-soft)" strokeWidth={1} />
            <text x={pad.l - 6} y={py(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">{v.toFixed(1)}</text>
            <text x={px(v)} y={height - 18} textAnchor="middle" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">{v.toFixed(1)}</text>
          </g>
        );
      })}
      {/* trust threshold line */}
      <line x1={pad.l} x2={pad.l + w} y1={py(threshold)} y2={py(threshold)} stroke="var(--warn)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
      <text x={pad.l + w} y={py(threshold) - 4} textAnchor="end" fontSize={9} fill="var(--warn)" fontFamily="var(--mono)">trust bar {threshold.toFixed(2)}</text>
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={px(p.x)} cy={py(p.y)} r={6} fill={p.y >= threshold ? "var(--accent)" : "var(--bad)"} opacity={0.9} stroke="var(--bg)" strokeWidth={1} />
          <text x={px(p.x)} y={py(p.y) - 9} textAnchor="middle" fontSize={9} fill={p.y >= threshold ? "var(--accent)" : "var(--bad)"} fontFamily="var(--mono)">{p.label}</text>
        </g>
      ))}
      <text x={pad.l} y={10} fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">{yLabel}</text>
      <text x={pad.l + w} y={height - 4} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">{xLabel}</text>
    </svg>
  );
}

// Horizontal labelled bars, for ranking a small set of named values 0..1.
export function HBars({
  rows,
  width = 560,
  rowHeight = 30,
}: {
  rows: { label: string; value: number; max?: number; variant?: "bad" | "warn" }[];
  width?: number;
  rowHeight?: number;
}) {
  const pad = { l: 130, r: 44 };
  const trackW = width - pad.l - pad.r;
  const height = rows.length * rowHeight + 8;
  const max = Math.max(1, ...rows.map((r) => r.max ?? 1));
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%" }}>
      {rows.map((r, i) => {
        const y = i * rowHeight + 4;
        const bw = (r.value / max) * trackW;
        const color = r.variant === "bad" ? "var(--bad)" : r.variant === "warn" ? "var(--warn)" : "var(--accent)";
        return (
          <g key={i}>
            <text x={pad.l - 8} y={y + rowHeight / 2} textAnchor="end" fontSize={11} fill="var(--text-dim)" fontFamily="var(--mono)">{r.label}</text>
            <rect x={pad.l} y={y + 4} width={trackW} height={rowHeight - 14} rx={3} fill="var(--border-soft)" />
            <rect x={pad.l} y={y + 4} width={Math.max(2, bw)} height={rowHeight - 14} rx={3} fill={color} opacity={0.85} />
            <text x={pad.l + trackW + 6} y={y + rowHeight / 2} textAnchor="start" fontSize={10} fill="var(--text-faint)" fontFamily="var(--mono)">{(r.value * 100).toFixed(0)}%</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Bar({
  value,
  max,
  variant,
}: {
  value: number;
  max: number;
  variant?: "warn" | "bad" | "blue";
}) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="bar-track">
      <div className={`bar-fill ${variant ?? ""}`} style={{ width: `${w}%` }} />
    </div>
  );
}
