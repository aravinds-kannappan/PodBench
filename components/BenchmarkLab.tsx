"use client";

import { useMemo, useState } from "react";
import type { Run } from "@/lib/types";
import { computeStats } from "@/lib/stats";
import { Scatter, Bar } from "@/components/charts";
import PropensityPanel from "@/components/PropensityPanel";
import { saveLocalRun } from "@/lib/clientStore";
import { usd, pct } from "@/lib/format";

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
const REWARD_BAR = 0.8;

type CellStatus = "queued" | "running" | "done" | "error";
interface Cell {
  key: string;
  model: string;
  trial: number;
  status: CellStatus;
  run?: Run;
  error?: string;
}

function shortModel(m: string): string {
  return m.replace(/^claude-/, "");
}

export default function BenchmarkLab({ tasks }: { tasks: TaskOpt[] }) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([MODELS[0], MODELS[1]]);
  const [trials, setTrials] = useState(2);
  const [effort, setEffort] = useState("medium");
  const [cells, setCells] = useState<Cell[]>([]);
  const [running, setRunning] = useState(false);

  const completedRuns = useMemo(
    () => cells.filter((c) => c.status === "done" && c.run).map((c) => c.run as Run),
    [cells]
  );
  const stats = useMemo(() => computeStats(completedRuns), [completedRuns]);

  function toggleModel(m: string) {
    setPicked((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  }

  async function runSweep() {
    if (running || picked.length === 0) return;
    const queue: Cell[] = [];
    for (const m of picked) {
      for (let t = 0; t < trials; t++) {
        queue.push({ key: `${m}#${t}`, model: m, trial: t, status: "queued" });
      }
    }
    setCells(queue);
    setRunning(true);

    for (const cell of queue) {
      setCells((prev) =>
        prev.map((c) => (c.key === cell.key ? { ...c, status: "running" } : c))
      );
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task_id: taskId, model: cell.model, effort }),
        });
        const data = await res.json();
        if (!res.ok) {
          setCells((prev) =>
            prev.map((c) =>
              c.key === cell.key ? { ...c, status: "error", error: data.error } : c
            )
          );
        } else {
          const run = data as Run;
          saveLocalRun(run);
          setCells((prev) =>
            prev.map((c) =>
              c.key === cell.key ? { ...c, status: "done", run } : c
            )
          );
        }
      } catch (e: any) {
        setCells((prev) =>
          prev.map((c) =>
            c.key === cell.key ? { ...c, status: "error", error: e?.message } : c
          )
        );
      }
    }
    setRunning(false);
  }

  const totalJobs = picked.length * trials;
  const doneJobs = cells.filter((c) => c.status === "done" || c.status === "error").length;

  // Efficiency frontier inputs and the automated recommendation.
  const points = stats.by_model.map((m) => ({
    label: shortModel(m.model),
    x: m.avg_cost_per_run,
    y: m.avg_reward,
  }));
  const recommendation = useMemo(() => {
    const models = stats.by_model.filter((m) => m.runs > 0);
    if (models.length < 1) return null;
    const EPS = 0.005;
    const ceiling = Math.max(...models.map((m) => m.avg_reward));
    const floor = Math.min(...models.map((m) => m.avg_reward));
    const spread = ceiling - floor;
    // models statistically at the top, and the priciest one among them — that is
    // the spend you would avoid by picking the cheaper equal-quality worker.
    const topTier = models.filter((m) => m.avg_reward >= ceiling - EPS);
    const priciestTop = [...topTier].sort((a, b) => b.avg_cost_per_run - a.avg_cost_per_run)[0];
    const bestReward = [...models].sort((a, b) => b.avg_reward - a.avg_reward)[0];
    const qualified = models.filter((m) => m.avg_reward >= REWARD_BAR);
    const value =
      qualified.length > 0
        ? [...qualified].sort((a, b) => a.avg_cost_per_run - b.avg_cost_per_run)[0]
        : null;
    const valueIsTop = value ? value.avg_reward >= ceiling - EPS : false;
    const tiedAtTop = topTier.length > 1;
    const savingVsPriciest =
      value && value.avg_cost_per_run > 0
        ? priciestTop.avg_cost_per_run / value.avg_cost_per_run
        : 1;
    const savingVsBest =
      value && value.avg_cost_per_run > 0
        ? bestReward.avg_cost_per_run / value.avg_cost_per_run
        : 1;
    return {
      models,
      ceiling,
      spread,
      topTier,
      priciestTop,
      bestReward,
      value,
      valueIsTop,
      tiedAtTop,
      savingVsPriciest,
      savingVsBest,
    };
  }, [stats]);

  return (
    <>
      {/* CONFIG */}
      <section className="section">
        <div className="section-head">
          <h2>benchmark sweep</h2>
          <span className="hint">same environment, head-to-head across models &middot; real API cost</span>
        </div>
        <div className="card">
          <div className="bench-config">
            <label className="field">
              <span className="field-label">environment</span>
              <select value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={running}>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.difficulty.toUpperCase()} / {t.title}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">effort</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={running}>
                {EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">trials / model</span>
              <select value={trials} onChange={(e) => setTrials(Number(e.target.value))} disabled={running}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          <div className="model-picker">
            <span className="field-label">models</span>
            <div className="model-chips">
              {MODELS.map((m) => (
                <button
                  key={m}
                  className={`chip ${picked.includes(m) ? "on" : ""}`}
                  onClick={() => toggleModel(m)}
                  disabled={running}
                >
                  {picked.includes(m) ? "✓ " : ""}{shortModel(m)}
                </button>
              ))}
            </div>
          </div>

          <div className="bench-actions">
            <button className="primary" onClick={runSweep} disabled={running || picked.length === 0}>
              {running ? `running ${doneJobs}/${totalJobs}…` : `run sweep (${totalJobs} run${totalJobs === 1 ? "" : "s"})`}
            </button>
            <span className="faint mono" style={{ fontSize: 11 }}>
              {picked.length} model{picked.length === 1 ? "" : "s"} × {trials} trial{trials === 1 ? "" : "s"} = {totalJobs} live calls
            </span>
          </div>

          {cells.length > 0 && (
            <div className="sweep-grid">
              {cells.map((c) => (
                <div
                  key={c.key}
                  className={`sweep-cell ${c.status}`}
                  title={`${c.model} trial ${c.trial + 1}: ${c.status}${c.run ? ` reward ${c.run.reward.toFixed(2)}` : ""}`}
                >
                  <span className="sc-model">{shortModel(c.model)}</span>
                  <span className="sc-val">
                    {c.status === "done" && c.run ? c.run.reward.toFixed(2)
                      : c.status === "running" ? "…"
                      : c.status === "error" ? "err"
                      : "·"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* RECOMMENDATION */}
      {recommendation && completedRuns.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>efficiency frontier</h2>
            <span className="hint">cost vs. quality — the cheapest model on the dashed line wins its quality tier</span>
          </div>
          <div className="grid-2">
            <div className="card">
              <h3>cost vs reward<span className="h3sub">solid points are Pareto-optimal</span></h3>
              <Scatter points={points} />
              <div className="legend">
                <span>x: average cost per run &middot; y: average reward &middot; up-and-left is better.</span>
              </div>
            </div>
            <div className="card reco">
              <h3>recommendation<span className="h3sub">reward bar = {REWARD_BAR.toFixed(2)}</span></h3>
              {recommendation.value ? (
                <>
                  <div className="reco-pick">
                    <span className="reco-model mono">{shortModel(recommendation.value.model)}</span>
                    <span className="badge pass">best value</span>
                  </div>
                  <p className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
                    Cheapest model clearing the {REWARD_BAR.toFixed(2)} reward bar at{" "}
                    <strong className="mono">{usd(recommendation.value.avg_cost_per_run)}</strong>/run
                    {" "}({pct(recommendation.value.avg_reward, 0)} reward, {pct(recommendation.value.pass_rate, 0)} pass).
                  </p>
                  <p className="dim" style={{ fontSize: 13 }}>
                    {recommendation.valueIsTop ? (
                      recommendation.tiedAtTop ? (
                        <>
                          <strong>{recommendation.topTier.length} models tied at the top</strong> ({recommendation.ceiling.toFixed(3)} reward),
                          so paying{" "}
                          {recommendation.savingVsPriciest > 1.05 ? (
                            <>
                              <strong className="mono">{recommendation.savingVsPriciest.toFixed(1)}×</strong> more for{" "}
                              <span className="mono">{shortModel(recommendation.priciestTop.model)}</span>
                            </>
                          ) : (
                            <>more for a heavier model</>
                          )}{" "}
                          buys no measurable quality on this environment. Reserve the
                          Opus-class budget for harder tasks — it is not recommended here.
                        </>
                      ) : (
                        <>
                          It is also the most accurate model in the sweep, so there is no
                          accuracy/cost tradeoff to make — it wins on both axes.
                        </>
                      )
                    ) : (
                      <>
                        It gives up{" "}
                        <strong className="mono">
                          {(recommendation.bestReward.avg_reward - recommendation.value.avg_reward).toFixed(3)}
                        </strong>{" "}
                        reward versus top-scoring{" "}
                        <span className="mono">{shortModel(recommendation.bestReward.model)}</span>{" "}
                        but costs{" "}
                        <strong className="mono">{recommendation.savingVsBest.toFixed(1)}×</strong> less.
                        Pick <span className="mono">{shortModel(recommendation.bestReward.model)}</span> only
                        if that last margin matters.
                      </>
                    )}
                  </p>
                  <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
                    {recommendation.spread < 0.01
                      ? "All models scored within a rounding error here — this environment doesn't separate them. Differentiation shows up on harder tasks or at lower effort."
                      : `Reward spread across models: ${recommendation.spread.toFixed(3)} — this environment does separate them.`}
                  </p>
                </>
              ) : (
                <p className="dim" style={{ fontSize: 13 }}>
                  No model cleared the {REWARD_BAR.toFixed(2)} reward bar in this sweep. Highest reward so far:{" "}
                  <strong className="mono">{shortModel(recommendation.bestReward.model)}</strong> at{" "}
                  {recommendation.bestReward.avg_reward.toFixed(3)} ({usd(recommendation.bestReward.avg_cost_per_run)}/run).
                  Try raising effort or trials.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* COMPARISON TABLE */}
      <section className="section">
        <div className="section-head">
          <h2>head-to-head</h2>
          <span className="hint">aggregated over this sweep&apos;s completed runs</span>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>model</th>
                <th className="num">runs</th>
                <th>pass rate</th>
                <th className="num">avg reward</th>
                <th>trust</th>
                <th className="num">flags</th>
                <th className="num">$/run</th>
                <th className="num">cache</th>
              </tr>
            </thead>
            <tbody>
              {stats.by_model.length > 0 ? (
                [...stats.by_model]
                  .sort((a, b) => b.avg_reward - a.avg_reward)
                  .map((m) => (
                    <tr key={m.model}>
                      <td className="mono">{shortModel(m.model)}</td>
                      <td className="num">{m.runs}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Bar value={m.pass_rate} max={1} variant={m.pass_rate < 0.6 ? "bad" : m.pass_rate < 0.8 ? "warn" : undefined} />
                          <span className="mono faint">{pct(m.pass_rate, 0)}</span>
                        </div>
                      </td>
                      <td className="num">{m.avg_reward.toFixed(3)}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Bar value={m.avg_propensity} max={1} variant={m.avg_propensity < 0.6 ? "bad" : m.avg_propensity < 0.85 ? "warn" : undefined} />
                          <span className="mono faint">{m.avg_propensity.toFixed(3)}</span>
                        </div>
                      </td>
                      <td className="num">{pct(m.flag_rate, 0)}</td>
                      <td className="num">{usd(m.avg_cost_per_run)}</td>
                      <td className="num">{pct(m.avg_cache_hit_rate, 0)}</td>
                    </tr>
                  ))
              ) : (
                <tr>
                  <td colSpan={8} className="dim" style={{ padding: 18, textAlign: "center" }}>
                    Configure a sweep above and run it to compare models head-to-head.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* PROPENSITY — surfaces when the sweep includes a probe environment */}
      {completedRuns.length > 0 && stats.propensity_runs > 0 && (
        <PropensityPanel
          stats={stats}
          hint="behavioral trust for this sweep — run a scope-creep / test-gaming / redirection environment to separate models on trust, not just cost"
        />
      )}
    </>
  );
}
