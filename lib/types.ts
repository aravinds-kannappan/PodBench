// Shared domain types for podbench.

export type Difficulty = "easy" | "medium" | "hard";

export type RunStatus = "passed" | "failed" | "error";

// Where a run's numbers came from. "live" = a real episode executed against the
// model API and the programmatic verifier. "simulated" = a seeded fixture from
// scripts/gen.mjs, used only to populate the reference dashboard before any real
// runs exist. The UI must never show a simulated number as if it were measured,
// so every run carries its provenance and the dashboard surfaces it.
export type RunSource = "live" | "simulated";

// A propensity probe is an environment built to measure a *behavioral* tendency
// rather than capability: whether the agent stays in scope, refuses to game the
// grader, and obeys a mid-task redirection. These map to the failure modes that
// cause production incidents (scope creep, specification gaming, resistance to
// control) — the second axis alongside task correctness.
export type ProbeKind = "scope_creep" | "test_gaming" | "redirection";

export type PropensityFlag =
  | "scope_creep"
  | "test_gaming"
  | "resistance_to_redirection";

// The behavioral score for one episode, computed by the verifier from the SQL
// the agent actually ran (not just the final state). 1.0 = fully trustworthy
// behavior; flags name the specific tendencies that fired.
export interface PropensityScore {
  score: number; // 0..1, 1 = trustworthy behavior
  flags: PropensityFlag[];
  writes: number; // count of mutating statements the agent issued
  writes_after_redirect: number; // mutations after a stop order, if one was sent
  probe: ProbeKind | null; // the tendency this environment targets, if any
  detail: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface TrajectoryStep {
  index: number;
  kind: "tool_call" | "tool_result" | "message" | "submit";
  tool?: string;
  input?: unknown;
  output?: string;
  ms: number;
}

export interface Run {
  id: string;
  task_id: string;
  task_title: string;
  difficulty: Difficulty;
  model: string;
  status: RunStatus;
  passed: boolean;
  reward: number;
  detail: string;
  steps: number;
  started_at: string;
  finished_at: string;
  latency_ms: number;
  usage: TokenUsage;
  cost_usd: number;
  cache_hit_rate: number;
  retries: number;
  pod: string;
  queue: "sqs" | "redis";
  source: RunSource;
  propensity?: PropensityScore;
  trajectory?: TrajectoryStep[];
  error?: string;
}

export type PodPhase =
  | "Running"
  | "Pending"
  | "CrashLoopBackOff"
  | "Completed";

export interface Pod {
  name: string;
  node: string;
  phase: PodPhase;
  restarts: number;
  cpu_milli: number;
  mem_mi: number;
  cpu_limit_milli: number;
  mem_limit_mi: number;
  runs_handled: number;
  started_at: string;
  cpu_series: number[];
  mem_series: number[];
}

export interface FleetEvent {
  ts: string;
  pod: string;
  type: "Normal" | "Warning";
  reason: string;
  message: string;
}

export interface Fleet {
  generated_at: string;
  window_minutes: number;
  ts_series: string[];
  queue_depth_series: number[];
  inflight_series: number[];
  desired_replicas: number;
  current_replicas: number;
  pods: Pod[];
  events: FleetEvent[];
}
