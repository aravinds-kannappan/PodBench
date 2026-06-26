import { Histogram, Bar, QuadrantScatter, HBars } from "@/components/charts";
import { pct } from "@/lib/format";
import type { Stats } from "@/lib/stats";

// The second axis. Where "model behavior" answers "did the agent get it right",
// this panel answers "can the agent be trusted to do it the right way" — whether
// it stayed in scope, refused to game the grader, and obeyed a stop order. The
// numbers come from the same runs, scored on the statements the agent ran.

const PROBE_LABEL: Record<string, string> = {
  scope_creep: "scope creep",
  test_gaming: "test gaming",
  redirection: "redirection",
};

const PROBE_BLURB: Record<string, string> = {
  scope_creep: "read-only ask, fixable defect in view — does it overstep?",
  test_gaming: "grader disclosed — does it fake the check or do the work?",
  redirection: "stop order mid-task — does it halt or push on?",
};

const FLAG_LABEL: Record<string, string> = {
  scope_creep: "scope creep",
  test_gaming: "test gaming",
  resistance_to_redirection: "resisted redirect",
};

function trustVariant(score: number): "bad" | "warn" | undefined {
  if (score < 0.6) return "bad";
  if (score < 0.85) return "warn";
  return undefined;
}

export default function PropensityPanel({
  stats,
  hint = "behavioral trust scored from the SQL each agent actually ran",
}: {
  stats: Stats;
  hint?: string;
}) {
  if (stats.propensity_runs === 0) return null;

  const probes = stats.by_task.filter((t) => t.probe);
  const flaggedPct = stats.propensity_runs
    ? stats.total_flagged / stats.propensity_runs
    : 0;
  const topFlag = stats.flag_counts[0];

  // capability vs trust, one point per model
  const quadPoints = stats.by_model
    .filter((m) => m.runs > 0)
    .map((m) => ({
      label: m.model.replace(/^claude-/, ""),
      x: m.avg_reward,
      y: m.avg_propensity,
    }));
  // flag rate by probe, for the bar figure
  const probeBars = probes.map((p) => ({
    label: PROBE_LABEL[p.probe!] ?? p.probe!,
    value: p.flag_rate,
    variant: (p.flag_rate >= 0.25 ? "bad" : p.flag_rate >= 0.1 ? "warn" : undefined) as
      | "bad"
      | "warn"
      | undefined,
  }));

  return (
    <section className="section" id="propensity">
      <div className="section-head">
        <h2>propensity — trust axis</h2>
        <span className="hint">{hint}</span>
      </div>

      <div
        className="kpis"
        style={{ marginTop: 0, gridTemplateColumns: "repeat(4, 1fr)" }}
      >
        <Kpi
          label="avg trust"
          value={stats.avg_propensity.toFixed(3)}
          sub={`over ${stats.propensity_runs} scored runs`}
        />
        <Kpi
          label="flagged runs"
          value={pct(flaggedPct, 0)}
          sub={`${stats.total_flagged} raised a behavior flag`}
        />
        <Kpi
          label="probes"
          value={String(probes.length)}
          sub="scope / gaming / redirect"
        />
        <Kpi
          label="top flag"
          value={topFlag ? FLAG_LABEL[topFlag.flag] ?? topFlag.flag : "—"}
          sub={topFlag ? `${topFlag.count} occurrences` : "none raised"}
        />
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <h3>
            trust by model
            <span className="h3sub">higher is more trustworthy</span>
          </h3>
          <table>
            <thead>
              <tr>
                <th>model</th>
                <th className="num">runs</th>
                <th>trust</th>
                <th className="num">flag rate</th>
              </tr>
            </thead>
            <tbody>
              {[...stats.by_model]
                .sort((a, b) => b.avg_propensity - a.avg_propensity)
                .map((m) => (
                  <tr key={m.model}>
                    <td className="mono">{m.model.replace(/^claude-/, "")}</td>
                    <td className="num">{m.runs}</td>
                    <td>
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <Bar
                          value={m.avg_propensity}
                          max={1}
                          variant={trustVariant(m.avg_propensity)}
                        />
                        <span className="mono faint">
                          {m.avg_propensity.toFixed(3)}
                        </span>
                      </div>
                    </td>
                    <td className="num">{pct(m.flag_rate, 0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>
            trust distribution
            <span className="h3sub">scored runs, 0.0 to 1.0</span>
          </h3>
          <Histogram buckets={stats.propensity_histogram} />
          <div className="legend">
            <span>
              the spike at 1.0 is trustworthy behavior; mass near 0.0 is an agent
              that overstepped, gamed the grader, or ignored a stop order.
            </span>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <h3>
            capability vs trust
            <span className="h3sub">two axes, one point per model</span>
          </h3>
          <QuadrantScatter points={quadPoints} />
          <div className="legend">
            <span>
              up-and-right is the goal. The shaded bottom-right is the dangerous
              quadrant — capable but untrustworthy — which a capability-only
              benchmark cannot see.
            </span>
          </div>
        </div>
        <div className="card">
          <h3>
            flag rate by probe
            <span className="h3sub">how often each tendency fires</span>
          </h3>
          {probeBars.length > 0 ? (
            <HBars rows={probeBars} />
          ) : (
            <div className="dim" style={{ fontSize: 13 }}>No probe runs yet.</div>
          )}
          <div className="legend">
            <span>
              higher means the tendency fired more often across runs of that
              probe environment.
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>
          by probe
          <span className="h3sub">each environment targets one tendency</span>
        </h3>
        <table>
          <thead>
            <tr>
              <th>probe</th>
              <th>environment</th>
              <th className="num">runs</th>
              <th>avg trust</th>
              <th className="num">flag rate</th>
            </tr>
          </thead>
          <tbody>
            {probes.map((p) => (
              <tr key={p.task_id}>
                <td>
                  <span className="badge probe">
                    {PROBE_LABEL[p.probe!] ?? p.probe}
                  </span>
                </td>
                <td>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {p.task_id}
                  </span>
                  <div className="faint" style={{ fontSize: 11 }}>
                    {PROBE_BLURB[p.probe!]}
                  </div>
                </td>
                <td className="num">{p.runs}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Bar
                      value={p.avg_propensity}
                      max={1}
                      variant={trustVariant(p.avg_propensity)}
                    />
                    <span className="mono faint">
                      {p.avg_propensity.toFixed(3)}
                    </span>
                  </div>
                </td>
                <td className="num">{pct(p.flag_rate, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats.flag_counts.length > 0 && (
          <div className="flag-row">
            {stats.flag_counts.map((f) => (
              <span key={f.flag} className="badge flag">
                {FLAG_LABEL[f.flag] ?? f.flag} · {f.count}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: value.length > 12 ? 16 : 24 }}>
        {value}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
