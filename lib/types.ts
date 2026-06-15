// Shared domain types for podbench.

export type Difficulty = "easy" | "medium" | "hard";

export type RunStatus = "passed" | "failed" | "error";

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
