import { AreaChart, Histogram, Bar } from "@/components/charts";
import { pct, usd } from "@/lib/format";
import type { Stats } from "@/lib/stats";

// Reference-corpus model behavior: policy quality, cost, and caching per model
// and per environment. Shared by the overview and the demo dashboard.
export default function ModelBehavior({
  stats,
  hint = "policy quality, cost, and caching per model and task",
}: {
  stats: Stats;
  hint?: string;
}) {
  return (
    <section className="section" id="behavior">
      <div className="section-head">
        <h2>model behavior</h2>
        <span className="hint">{hint}</span>
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
  );
}
