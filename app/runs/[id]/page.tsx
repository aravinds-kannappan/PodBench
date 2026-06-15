import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/lib/data/store";
import { usd, pct, ms, compact, ago } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();

  const u = run.usage;

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <div className="logo">pb</div>
            <div>
              <h1>podbench</h1>
            </div>
          </div>
          <nav className="masthead-links">
            <Link href="/">dashboard</Link>
          </nav>
        </div>
      </header>

      <main className="wrap">
        <div style={{ marginTop: 20 }}>
          <Link href="/" className="back-link">
            {"<- back to dashboard"}
          </Link>
        </div>

        <section className="section" style={{ marginTop: 18 }}>
          <div className="section-head">
            <h2 className="mono">{run.id}</h2>
            <span className="hint">{ago(run.started_at)}</span>
          </div>

          <div className="card">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <span className={`badge ${run.status === "passed" ? "pass" : run.status === "failed" ? "fail" : "err"}`}>
                {run.status}
              </span>
              <span className={`badge ${run.difficulty}`}>{run.difficulty}</span>
              <strong>{run.task_title}</strong>
              <span className="faint mono" style={{ fontSize: 12 }}>({run.task_id})</span>
            </div>
            <div className="dim mono" style={{ fontSize: 12 }}>verifier: {run.detail}</div>
            {run.error && <div className="notice" style={{ marginTop: 8 }}>error: {run.error}</div>}
          </div>

          <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <Kpi label="reward" value={run.reward.toFixed(3)} sub={run.passed ? "passed" : "failed"} />
            <Kpi label="model" value={run.model} sub={`${run.steps} steps`} />
            <Kpi label="cost" value={usd(run.cost_usd)} sub={`${compact(totalTokens(run))} tokens`} />
            <Kpi label="latency" value={ms(run.latency_ms)} sub={`${run.retries} rate-limit retries`} />
          </div>

          <div className="grid-2" style={{ marginTop: 18 }}>
            <div className="card">
              <h3>token accounting</h3>
              <table>
                <tbody>
                  <Row k="input (uncached)" v={compact(u.input_tokens)} />
                  <Row k="cache write" v={compact(u.cache_creation_input_tokens)} note="billed 1.25x input" />
                  <Row k="cache read" v={compact(u.cache_read_input_tokens)} note="billed 0.1x input" />
                  <Row k="output" v={compact(u.output_tokens)} />
                  <Row k="cache hit rate" v={pct(run.cache_hit_rate)} />
                  <Row k="cost" v={usd(run.cost_usd)} />
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>scheduling</h3>
              <table>
                <tbody>
                  <Row k="pod" v={run.pod} />
                  <Row k="queue" v={run.queue} />
                  <Row k="started" v={run.started_at.replace("T", " ").slice(0, 19)} />
                  <Row k="finished" v={run.finished_at.replace("T", " ").slice(0, 19)} />
                  <Row k="steps" v={String(run.steps)} />
                  <Row k="retries" v={String(run.retries)} />
                </tbody>
              </table>
            </div>
          </div>

          {run.trajectory && run.trajectory.length > 0 && (
            <div className="card" style={{ marginTop: 18 }}>
              <h3>
                trajectory<span className="h3sub">{run.trajectory.length} steps</span>
              </h3>
              <div className="trace">
                {run.trajectory.map((s) => {
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
                        {s.output}
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
                      {s.output}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(!run.trajectory || run.trajectory.length === 0) && (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="faint">
                No step-level trajectory recorded for this run. Trajectories are kept
                for runs executed through the live runner and the worker.
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function totalTokens(run: { usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } }) {
  const u = run.usage;
  return u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: value.length > 14 ? 15 : 24 }}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <tr>
      <td className="dim">{k}</td>
      <td className="num">
        {v}
        {note && <div className="faint" style={{ fontSize: 10 }}>{note}</div>}
      </td>
    </tr>
  );
}
