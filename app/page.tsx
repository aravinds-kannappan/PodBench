import Link from "next/link";
import { getRuns, getFleet, computeStats } from "@/lib/data/store";
import { TASKS } from "@/lib/env/tasks";
import { AreaChart, Histogram, Sparkline, Bar } from "@/components/charts";
import LiveRun from "@/components/LiveRun";
import { pct, usd, compact, ms, shortTime, ago } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Page() {
  const runs = await getRuns();
  const fleet = await getFleet();
  const stats = computeStats(runs);
  const recent = runs.slice(0, 12);
  const queuePeak = Math.max(...fleet.queue_depth_series);
  const running = fleet.pods.filter((p) => p.phase === "Running").length;

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div>
            <div className="brand">
              <div className="logo">pb</div>
              <div>
                <h1>
                  podbench <span className="ver">v0.4.2</span>
                </h1>
              </div>
            </div>
            <p className="tagline">
              Deterministic, resettable task environments for LLM agents with a
              programmatic verifier, run concurrently on Kubernetes with per-run
              token metering, rate-limit backoff, and prompt caching. Pod health
              and model behavior on one pane.
            </p>
          </div>
          <nav className="masthead-links">
            <a href="#environments">environments</a>
            <a href="#behavior">behavior</a>
            <a href="#fleet">fleet</a>
            <a href="https://github.com/podbench/podbench">github</a>
          </nav>
        </div>
      </header>

      <nav className="subnav">
        <div className="subnav-inner">
          <a href="#behavior">model behavior</a>
          <a href="#fleet">pod health</a>
          <a href="#run">run an agent</a>
          <a href="#runs">recent runs</a>
          <a href="#environments">environments</a>
        </div>
      </nav>

      <main className="wrap">
        <section className="kpis">
          <Kpi label="runs recorded" value={String(stats.total_runs)} sub={`${TASKS.length} environments`} />
          <Kpi label="pass rate" value={pct(stats.pass_rate)} sub="programmatic verifier" />
          <Kpi label="spend" value={usd(stats.total_cost_usd)} sub={`${compact(stats.total_tokens)} tokens`} />
          <Kpi label="cache hit rate" value={pct(stats.avg_cache_hit_rate)} sub="input served from cache" />
          <Kpi label="rate-limit retries" value={String(stats.total_retries)} sub="backed off and recovered" />
          <Kpi label="p50 latency" value={ms(stats.avg_latency_ms)} sub="mean wall-clock per run" />
        </section>

        {/* MODEL BEHAVIOR */}
        <section className="section" id="behavior">
          <div className="section-head">
            <h2>model behavior</h2>
            <span className="hint">policy quality, cost, and caching per model and task</span>
          </div>

          <div className="grid-2">
            <div className="card">
              <h3>
                by model<span className="h3sub">same environments, different policies</span>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>model</th>
                    <th className="num">runs</th>
                    <th>pass rate</th>
                    <th className="num">reward</th>
                    <th className="num">cache</th>
                    <th className="num">$/run</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_model.map((m) => (
                    <tr key={m.model}>
                      <td className="mono">{m.model}</td>
                      <td className="num">{m.runs}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Bar value={m.pass_rate} max={1} variant={m.pass_rate < 0.6 ? "bad" : m.pass_rate < 0.8 ? "warn" : undefined} />
                          <span className="mono faint">{pct(m.pass_rate, 0)}</span>
                        </div>
                      </td>
                      <td className="num">{m.avg_reward.toFixed(3)}</td>
                      <td className="num">{pct(m.avg_cache_hit_rate, 0)}</td>
                      <td className="num">{usd(m.avg_cost_per_run)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3>
                reward distribution<span className="h3sub">all runs, 0.0 to 1.0</span>
              </h3>
              <Histogram buckets={stats.reward_histogram} />
              <div className="legend">
                <span>bars at 0.0 are hard failures; the spike at 1.0 is clean passes; the middle is partial credit on state-mutation tasks.</span>
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 18 }}>
            <div className="card">
              <h3>
                spend over time<span className="h3sub">USD per day, all models</span>
              </h3>
              <AreaChart
                data={stats.cost_over_time.map((d) => d.cost)}
                labels={stats.cost_over_time.map((d) => d.ts.slice(5))}
                color="var(--accent)"
                yLabel="$/day"
              />
            </div>
            <div className="card">
              <h3>
                by environment<span className="h3sub">pass rate and average steps</span>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>environment</th>
                    <th>diff</th>
                    <th className="num">runs</th>
                    <th>pass rate</th>
                    <th className="num">steps</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_task.map((t) => (
                    <tr key={t.task_id}>
                      <td className="mono" style={{ fontSize: 12 }}>{t.task_id}</td>
                      <td>
                        <span className={`badge ${t.difficulty}`}>{t.difficulty}</span>
                      </td>
                      <td className="num">{t.runs}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Bar value={t.pass_rate} max={1} variant={t.pass_rate < 0.6 ? "bad" : t.pass_rate < 0.8 ? "warn" : undefined} />
                          <span className="mono faint">{pct(t.pass_rate, 0)}</span>
                        </div>
                      </td>
                      <td className="num">{t.avg_steps.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FLEET */}
        <section className="section" id="fleet">
          <div className="section-head">
            <h2>pod health</h2>
            <span className="hint">
              live cluster window, last {fleet.window_minutes} minutes, generated {ago(fleet.generated_at)}
            </span>
          </div>

          <div className="kpis" style={{ marginTop: 0, gridTemplateColumns: "repeat(4, 1fr)" }}>
            <Kpi label="replicas" value={`${fleet.current_replicas}/${fleet.desired_replicas}`} sub="current / desired (HPA)" />
            <Kpi label="pods running" value={`${running}/${fleet.pods.length}`} sub="ready in the deployment" />
            <Kpi label="queue peak" value={String(queuePeak)} sub="max backlog in window" />
            <Kpi label="inflight now" value={String(fleet.inflight_series.at(-1) ?? 0)} sub="episodes executing" />
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <h3>
              queue depth<span className="h3sub">Redis stream backlog; HPA scales workers off this signal</span>
            </h3>
            <AreaChart
              data={fleet.queue_depth_series}
              labels={fleet.ts_series.map((t) => shortTime(t))}
              color="var(--accent-2)"
              yLabel="depth"
              height={150}
            />
            <div className="legend">
              <span>A burst arrives, the autoscaler adds workers, the backlog drains. The two scale events are in the event feed below.</span>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 18 }}>
            <div className="card">
              <h3>
                pods<span className="h3sub">cpu and memory per worker</span>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>pod</th>
                    <th>phase</th>
                    <th className="num">rst</th>
                    <th>cpu</th>
                    <th>mem</th>
                    <th className="num">runs</th>
                  </tr>
                </thead>
                <tbody>
                  {fleet.pods.map((p) => (
                    <tr key={p.name}>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {p.name}
                        <div className="faint" style={{ fontSize: 10 }}>{p.node}</div>
                      </td>
                      <td>
                        <span className={`badge ${phaseClass(p.phase)}`}>{p.phase}</span>
                      </td>
                      <td className="num">{p.restarts}</td>
                      <td>
                        <Sparkline data={p.cpu_series} limit={p.cpu_limit_milli} color="var(--accent-2)" width={90} />
                        <div className="faint mono" style={{ fontSize: 10 }}>{p.cpu_milli}/{p.cpu_limit_milli}m</div>
                      </td>
                      <td>
                        <Sparkline data={p.mem_series} limit={p.mem_limit_mi} color={p.mem_mi > p.mem_limit_mi * 0.85 ? "var(--bad)" : "var(--accent)"} width={90} />
                        <div className="faint mono" style={{ fontSize: 10 }}>{p.mem_mi}/{p.mem_limit_mi}Mi</div>
                      </td>
                      <td className="num">{p.runs_handled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3>
                cluster events<span className="h3sub">scheduling, scaling, OOM, and app-level signals</span>
              </h3>
              <div className="events">
                {fleet.events.map((e, i) => (
                  <div key={i} className={`event ${e.type === "Warning" ? "warn" : "normal"}`}>
                    <span className="etime">{shortTime(e.ts)}</span>
                    <span className="ereason">{e.reason}</span>
                    <span className="emsg">{e.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* RUN */}
        <section className="section" id="run">
          <div className="section-head">
            <h2>run an agent</h2>
            <span className="hint">requires ANTHROPIC_API_KEY in the environment</span>
          </div>
          <LiveRun tasks={TASKS.map((t) => ({ id: t.id, title: t.title, difficulty: t.difficulty }))} />
        </section>

        {/* RECENT RUNS */}
        <section className="section" id="runs">
          <div className="section-head">
            <h2>recent runs</h2>
            <span className="hint">newest first</span>
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
                  <th className="num">steps</th>
                  <th className="num">cost</th>
                  <th className="num">cache</th>
                  <th className="num">rt</th>
                  <th>pod</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="faint mono" style={{ fontSize: 11 }}>{ago(r.started_at)}</td>
                    <td>
                      <Link href={`/runs/${r.id}`} className="mono" style={{ fontSize: 12 }}>{r.task_id}</Link>
                      <span className={`badge ${r.difficulty}`} style={{ marginLeft: 6 }}>{r.difficulty}</span>
                    </td>
                    <td className="mono faint" style={{ fontSize: 11 }}>{r.model}</td>
                    <td>
                      <span className={`badge ${r.status === "passed" ? "pass" : r.status === "failed" ? "fail" : "err"}`}>{r.status}</span>
                    </td>
                    <td className="num">{r.reward.toFixed(3)}</td>
                    <td className="num">{r.steps}</td>
                    <td className="num">{usd(r.cost_usd)}</td>
                    <td className="num">{pct(r.cache_hit_rate, 0)}</td>
                    <td className="num">{r.retries}</td>
                    <td className="mono faint" style={{ fontSize: 10 }}>{r.pod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ENVIRONMENTS */}
        <section className="section" id="environments">
          <div className="section-head">
            <h2>environments</h2>
            <span className="hint">deterministic SQL tasks with programmatic reward</span>
          </div>
          <div className="grid-3">
            {TASKS.map((t) => (
              <div className="card" key={t.id}>
                <h3 style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="mono" style={{ fontSize: 12 }}>{t.id}</span>
                  <span className={`badge ${t.difficulty}`}>{t.difficulty}</span>
                </h3>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.title}</div>
                <div className="dim" style={{ fontSize: 12 }}>{t.prompt}</div>
                <div className="faint mono" style={{ fontSize: 11, marginTop: 10 }}>
                  kind: {t.kind} / reward: {t.kind === "answer" ? "exact match" : "weighted state checks"}
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="footer">
          <span>podbench is an open source agent evaluation harness. Apache-2.0.</span>
          <span className="mono">policy: claude-opus-4-8 / env: sql-ops / clock: 2026-06-15</span>
        </footer>
      </main>
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

function phaseClass(phase: string): string {
  if (phase === "Running") return "run";
  if (phase === "Pending") return "pend";
  if (phase === "CrashLoopBackOff") return "crash";
  return "done";
}
