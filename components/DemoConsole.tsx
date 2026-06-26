"use client";

import { useEffect, useMemo, useState } from "react";
import type { Run } from "@/lib/types";
import { computeStats } from "@/lib/stats";
import ModelBehavior from "@/components/ModelBehavior";
import PropensityPanel from "@/components/PropensityPanel";
import LiveFleet from "@/components/LiveFleet";
import {
  loadLocalRuns,
  saveLocalRun,
  clearLocalRuns,
} from "@/lib/clientStore";
import { usd, pct, ms, compact, ago } from "@/lib/format";

interface TaskOpt {
  id: string;
  title: string;
  difficulty: string;
}

const MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "gpt-5.5-pro",
  "gpt-5.5",
  "gemini-3.1-pro",
  "gemini-3.5-flash",
];
const EFFORTS = ["low", "medium", "high"];

export default function DemoConsole({ tasks }: { tasks: TaskOpt[] }) {
  const [mounted, setMounted] = useState(false);
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const [model, setModel] = useState(MODELS[0]);
  const [effort, setEffort] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);

  useEffect(() => {
    setMounted(true);
    setRuns(loadLocalRuns());
  }, []);

  const stats = useMemo(() => computeStats(runs), [runs]);

  async function execute(tid: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: tid, model, effort }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "run failed");
      } else {
        const run = data as Run;
        const next = saveLocalRun(run);
        setRuns(next);
        setSelected(run);
      }
    } catch (e: any) {
      setError(e?.message ?? "request failed");
    } finally {
      setBusy(false);
    }
  }

  function clearSession() {
    clearLocalRuns();
    setRuns([]);
    setSelected(null);
  }

  const hasRuns = runs.length > 0;

  return (
    <>
      {/* CONTROLS */}
      <section className="section" id="run">
        <div className="section-head">
          <h2>run an agent</h2>
          <span className="hint">live, against the real model and verifier &middot; needs OPENROUTER_API_KEY or ANTHROPIC_API_KEY</span>
        </div>
        <div className="card">
          <div className="controls">
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={busy}>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.difficulty.toUpperCase()} / {t.title}
                </option>
              ))}
            </select>
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
              {MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={busy}>
              {EFFORTS.map((e) => (
                <option key={e} value={e}>effort: {e}</option>
              ))}
            </select>
            <button className="primary" onClick={() => execute(taskId)} disabled={busy}>
              {busy ? "running..." : "run"}
            </button>
          </div>

          <div className="sample-row">
            <span className="faint mono" style={{ fontSize: 11 }}>quick samples:</span>
            {tasks.slice(0, 4).map((t) => (
              <button
                key={t.id}
                className="chip"
                disabled={busy}
                onClick={() => {
                  setTaskId(t.id);
                  execute(t.id);
                }}
              >
                {t.id}
              </button>
            ))}
          </div>

          {error && <div className="notice" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </section>

      {/* YOUR SESSION */}
      <section className="section">
        <div className="section-head">
          <h2>your session</h2>
          <span className="hint">
            {mounted
              ? hasRuns
                ? `${runs.length} run${runs.length === 1 ? "" : "s"} stored in this browser`
                : "no runs yet — execute one above to start collecting your own data"
              : "loading…"}
          </span>
        </div>

        <div className="kpis" style={{ marginTop: 0, gridTemplateColumns: "repeat(4, 1fr)" }}>
          <Kpi label="your runs" value={mounted ? String(stats.total_runs) : "—"} sub="this browser only" />
          <Kpi label="pass rate" value={mounted && hasRuns ? pct(stats.pass_rate) : "—"} sub="programmatic verifier" />
          <Kpi label="spend" value={mounted && hasRuns ? usd(stats.total_cost_usd) : "—"} sub={mounted && hasRuns ? `${compact(stats.total_tokens)} tokens` : "real API cost"} />
          <Kpi label="cache hit rate" value={mounted && hasRuns ? pct(stats.avg_cache_hit_rate) : "—"} sub="input from cache" />
        </div>

      </section>

      {/* LIVE MODEL BEHAVIOR — computed from this session's runs as they land */}
      {mounted && hasRuns && (
        <ModelBehavior
          stats={stats}
          hint="live — generated from the runs you execute, updating as each one lands"
        />
      )}

      {/* LIVE PROPENSITY — the behavioral axis over your own runs */}
      {mounted && hasRuns && (
        <PropensityPanel
          stats={stats}
          hint="live — behavioral trust scored from the SQL your agents ran. Try the scope-creep, test-gaming, and redirection probes."
        />
      )}

      {/* LIVE POD HEALTH — derived from the episodes you ran */}
      {mounted && hasRuns && <LiveFleet runs={runs} />}

      {/* TRAJECTORY */}
      {selected && (
        <section className="section">
          <div className="section-head">
            <h2>last run trajectory</h2>
            <span className="hint mono">{selected.task_id} &middot; {selected.model}</span>
          </div>
          <div className="card">
            <div className="kpis" style={{ marginTop: 0, gridTemplateColumns: "repeat(4, 1fr)" }}>
              <Kpi label="result" value={selected.passed ? "passed" : selected.status} sub={`reward ${selected.reward.toFixed(3)}`} />
              <Kpi label="cost" value={usd(selected.cost_usd)} sub={`${selected.steps} steps`} />
              <Kpi label="cache hit" value={pct(selected.cache_hit_rate)} sub={`${compact(selected.usage.cache_read_input_tokens)} read`} />
              <Kpi label="latency" value={ms(selected.latency_ms)} sub={`${selected.retries} retries`} />
            </div>
            <div className="faint mono" style={{ fontSize: 11, margin: "10px 0 6px" }}>{selected.detail}</div>
            {selected.propensity && (
              <div className="faint mono" style={{ fontSize: 11, margin: "0 0 6px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span>trust {selected.propensity.score.toFixed(2)}</span>
                {selected.propensity.flags.length > 0 ? (
                  selected.propensity.flags.map((f) => (
                    <span key={f} className="badge flag">{f.replace(/_/g, " ")}</span>
                  ))
                ) : (
                  <span className="badge clean">clean</span>
                )}
                <span>· {selected.propensity.detail}</span>
              </div>
            )}
            <div className="trace">
              {(selected.trajectory ?? []).map((s) => {
                if (s.kind === "tool_call")
                  return <div key={s.index} className="tcall">{">"} run_sql: {String(s.input)}</div>;
                if (s.kind === "tool_result")
                  return <div key={s.index} className="tres">{"  "}{truncate(s.output ?? "", 240)}</div>;
                if (s.kind === "submit")
                  return <div key={s.index} className="tsubmit">{"# submit "}{JSON.stringify(s.input)}</div>;
                return <div key={s.index} className="tmsg">{truncate(s.output ?? "", 300)}</div>;
              })}
            </div>
          </div>
        </section>
      )}

      {/* RECENT RUNS */}
      <section className="section">
        <div className="section-head">
          <h2>your recent runs</h2>
          {mounted && hasRuns && (
            <button className="chip danger" onClick={clearSession}>clear session</button>
          )}
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>when</th>
                <th>environment</th>
                <th>model</th>
                <th>result</th>
                <th className="num">reward</th>
                <th>trust</th>
                <th className="num">steps</th>
                <th className="num">cost</th>
                <th className="num">cache</th>
              </tr>
            </thead>
            <tbody>
              {mounted && hasRuns ? (
                runs.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: "pointer" }}>
                    <td className="faint mono" style={{ fontSize: 11 }}>{ago(r.started_at)}</td>
                    <td>
                      <span className="mono" style={{ fontSize: 12 }}>{r.task_id}</span>
                      <span className={`badge ${r.difficulty}`} style={{ marginLeft: 6 }}>{r.difficulty}</span>
                    </td>
                    <td className="mono faint" style={{ fontSize: 11 }}>{r.model}</td>
                    <td>
                      <span className={`badge ${r.status === "passed" ? "pass" : r.status === "failed" ? "fail" : "err"}`}>{r.status}</span>
                    </td>
                    <td className="num">{r.reward.toFixed(3)}</td>
                    <td>
                      {r.propensity ? (
                        r.propensity.flags.length > 0 ? (
                          <span className="badge flag">{r.propensity.score.toFixed(2)} ⚑</span>
                        ) : (
                          <span className="mono faint">{r.propensity.score.toFixed(2)}</span>
                        )
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="num">{r.steps}</td>
                    <td className="num">{usd(r.cost_usd)}</td>
                    <td className="num">{pct(r.cache_hit_rate, 0)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="dim" style={{ padding: 18, textAlign: "center" }}>
                    {mounted ? "Your runs will appear here." : "Loading…"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
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

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}
