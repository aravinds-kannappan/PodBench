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
