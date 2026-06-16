"use client";

import type { Run } from "@/lib/types";
import { AreaChart } from "@/components/charts";
import { usd, ms, ago } from "@/lib/format";

// Pod health derived live from the visitor's own runs. Unlike the overview's
// reference cluster snapshot, every number here is computed from the episodes
// you just executed — workers are the real pod ids the runner assigned, and the
// latency/retry/cost series grow as runs come in.
export default function LiveFleet({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return null;

  // chronological (oldest -> newest) for the timeline
  const chrono = [...runs].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const latencies = chrono.map((r) => r.latency_ms);
  const p50 = median(latencies);
  const retries = runs.reduce((s, r) => s + r.retries, 0);

  const pods = groupBy(runs, (r) => r.pod).map(([pod, list]) => {
    const sorted = [...list].sort((a, b) => b.started_at.localeCompare(a.started_at));
    return {
      pod,
      model: sorted[0].model,
      runs: list.length,
      avg_latency: list.reduce((s, r) => s + r.latency_ms, 0) / list.length,
      retries: list.reduce((s, r) => s + r.retries, 0),
      cost: list.reduce((s, r) => s + r.cost_usd, 0),
      passed: list.filter((r) => r.passed).length,
      last: sorted[0].started_at,
    };
  });

  return (
    <section className="section">
      <div className="section-head">
        <h2>pod health</h2>
        <span className="hint">live — derived from the episodes you executed in this session</span>
      </div>

      <div className="kpis" style={{ marginTop: 0, gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Kpi label="episodes" value={String(runs.length)} sub="executed this session" />
        <Kpi label="workers" value={String(pods.length)} sub="distinct pods used" />
        <Kpi label="rate-limit retries" value={String(retries)} sub="backed off and recovered" />
        <Kpi label="p50 latency" value={ms(Math.round(p50))} sub="median wall-clock per run" />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>
          execution latency<span className="h3sub">wall-clock per run, in execution order</span>
        </h3>
        <AreaChart
          data={latencies.map((l) => Math.round(l / 100) / 10)}
          labels={chrono.map((_, i) => `#${i + 1}`)}
          color="var(--accent-2)"
          yLabel="seconds"
          height={150}
        />
        <div className="legend">
          <span>Each point is one episode against the real model and verifier; spikes are usually rate-limit backoff.</span>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <h3>
            pods<span className="h3sub">workers that handled your episodes</span>
          </h3>
          <table>
            <thead>
              <tr>
                <th>pod</th>
                <th>model</th>
                <th className="num">runs</th>
                <th className="num">pass</th>
                <th className="num">latency</th>
                <th className="num">rt</th>
                <th className="num">cost</th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => (
                <tr key={p.pod}>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {p.pod}
                    <div className="faint" style={{ fontSize: 10 }}>{ago(p.last)}</div>
                  </td>
                  <td className="mono faint" style={{ fontSize: 11 }}>{p.model.replace(/^claude-/, "")}</td>
                  <td className="num">{p.runs}</td>
                  <td className="num">{p.passed}/{p.runs}</td>
                  <td className="num">{ms(Math.round(p.avg_latency))}</td>
                  <td className="num">{p.retries}</td>
                  <td className="num">{usd(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>
            execution events<span className="h3sub">one entry per episode, newest first</span>
          </h3>
          <div className="events">
            {runs.slice(0, 40).map((r) => (
              <div key={r.id} className={`event ${r.passed ? "normal" : "warn"}`}>
                <span className="etime">{ago(r.started_at)}</span>
                <span className="ereason">{r.status}</span>
                <span className="emsg">
                  {r.task_id} on {r.pod.replace(/^podbench-/, "")} — reward {r.reward.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k) ?? [];
    list.push(it);
    map.set(k, list);
  }
  return [...map.entries()];
}
