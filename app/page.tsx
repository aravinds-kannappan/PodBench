import Link from "next/link";
import { getRuns, getFleet, computeStats } from "@/lib/data/store";
import { TASKS } from "@/lib/env/tasks";
import Masthead from "@/components/Masthead";
import ModelBehavior from "@/components/ModelBehavior";
import FleetHealth from "@/components/FleetHealth";
import { pct, usd, compact, ms, ago } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Page() {
  const runs = await getRuns();
  const fleet = await getFleet();
  const stats = computeStats(runs);
  const recent = runs.slice(0, 12);

  return (
    <>
      <Masthead tagline="Deterministic, resettable SQL task environments for LLM agents with a programmatic verifier. The overview below is the published reference corpus; head to demo runs to execute your own agents live." />

      <main className="wrap">
        <section className="kpis">
          <Kpi label="runs recorded" value={String(stats.total_runs)} sub={`${TASKS.length} environments`} />
          <Kpi label="pass rate" value={pct(stats.pass_rate)} sub="programmatic verifier" />
          <Kpi label="spend" value={usd(stats.total_cost_usd)} sub={`${compact(stats.total_tokens)} tokens`} />
          <Kpi label="cache hit rate" value={pct(stats.avg_cache_hit_rate)} sub="input served from cache" />
          <Kpi label="rate-limit retries" value={String(stats.total_retries)} sub="backed off and recovered" />
          <Kpi label="p50 latency" value={ms(stats.avg_latency_ms)} sub="mean wall-clock per run" />
        </section>

        <div className="cta-row">
          <span className="dim">
            This is the shared, historical benchmark corpus. To run agents yourself and
            watch live results accumulate, open the
          </span>
          <Link href="/demo" className="cta-link">demo runs tab →</Link>
        </div>

        <ModelBehavior stats={stats} />

        <FleetHealth fleet={fleet} />

        {/* RECENT RUNS */}
        <section className="section" id="runs">
          <div className="section-head">
            <h2>recent runs</h2>
            <span className="hint">from the reference corpus &middot; newest first</span>
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
