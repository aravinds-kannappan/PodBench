"use client";

import { useState } from "react";
import type { Run } from "@/lib/types";
import { usd, pct, ms, compact } from "@/lib/format";

interface TaskOpt {
  id: string;
  title: string;
  difficulty: string;
}

const MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"];
const EFFORTS = ["low", "medium", "high"];

export default function LiveRun({ tasks }: { tasks: TaskOpt[] }) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const [model, setModel] = useState(MODELS[0]);
  const [effort, setEffort] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: taskId, model, effort }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "run failed");
      } else {
        setRun(data as Run);
      }
    } catch (e: any) {
      setError(e?.message ?? "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>
        Execute a run<span className="h3sub">live, against the real model and verifier</span>
      </h3>
      <div className="controls">
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.difficulty.toUpperCase()} / {t.title}
            </option>
          ))}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select value={effort} onChange={(e) => setEffort(e.target.value)}>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              effort: {e}
            </option>
          ))}
        </select>
        <button className="primary" onClick={go} disabled={busy}>
          {busy ? "running..." : "run"}
        </button>
      </div>

      {error && <div className="notice">{error}</div>}

      {run && (
        <>
          <div className="kpis" style={{ marginTop: 4, gridTemplateColumns: "repeat(4, 1fr)" }}>
            <Kpi label="result" value={run.passed ? "passed" : "failed"} sub={`reward ${run.reward.toFixed(3)}`} />
            <Kpi label="cost" value={usd(run.cost_usd)} sub={`${run.steps} steps`} />
            <Kpi label="cache hit" value={pct(run.cache_hit_rate)} sub={`${compact(run.usage.cache_read_input_tokens)} read`} />
            <Kpi label="latency" value={ms(run.latency_ms)} sub={`${run.retries} retries`} />
          </div>
          <div className="faint mono" style={{ fontSize: 11, margin: "10px 0 6px" }}>
            {run.detail}
          </div>
          <div className="trace">
            {(run.trajectory ?? []).map((s) => {
              if (s.kind === "tool_call")
                return (
                  <div key={s.index} className="tcall">
                    {">"} run_sql: {String(s.input)}
                  </div>
                );
              if (s.kind === "tool_result")
                return (
                  <div key={s.index} className="tres">
                    {"  "}
                    {truncate(s.output ?? "", 240)}
                  </div>
                );
              if (s.kind === "submit")
                return (
                  <div key={s.index} className="tsubmit">
                    {"# submit "}
                    {JSON.stringify(s.input)}
                  </div>
                );
              return (
                <div key={s.index} className="tmsg">
                  {truncate(s.output ?? "", 300)}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
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
