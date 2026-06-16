// Pure, dependency-free aggregation over a set of runs. Kept free of any Node
// (fs/path) imports so it can run unchanged on the server and inside client
// components that compute stats over runs held in the browser.
import type { Run } from "./types";

export interface Stats {
  total_runs: number;
  pass_rate: number;
  total_cost_usd: number;
  total_tokens: number;
  avg_cache_hit_rate: number;
  total_retries: number;
  avg_latency_ms: number;
  by_model: ModelStat[];
  by_task: TaskStat[];
  by_difficulty: DifficultyStat[];
  reward_histogram: number[];
  cost_over_time: { ts: string; cost: number; runs: number }[];
}

export interface ModelStat {
  model: string;
  runs: number;
  pass_rate: number;
  avg_reward: number;
  cost_usd: number;
  avg_cache_hit_rate: number;
  avg_cost_per_run: number;
  avg_latency_ms: number;
  tokens: number;
}

export interface TaskStat {
  task_id: string;
  title: string;
  difficulty: string;
  runs: number;
  pass_rate: number;
  avg_reward: number;
  avg_steps: number;
}

export interface DifficultyStat {
  difficulty: string;
  runs: number;
  pass_rate: number;
  avg_reward: number;
}

function tokensOf(r: Run): number {
  return (
    r.usage.input_tokens +
    r.usage.output_tokens +
    r.usage.cache_creation_input_tokens +
    r.usage.cache_read_input_tokens
  );
}

export function computeStats(runs: Run[]): Stats {
  const total = runs.length || 1;
  const passes = runs.filter((r) => r.passed).length;
  const totalCost = runs.reduce((s, r) => s + r.cost_usd, 0);
  const totalTokens = runs.reduce((s, r) => s + tokensOf(r), 0);
  const totalRetries = runs.reduce((s, r) => s + r.retries, 0);
  const avgCache = runs.reduce((s, r) => s + r.cache_hit_rate, 0) / total;
  const avgLatency = runs.reduce((s, r) => s + r.latency_ms, 0) / total;

  const byModel = groupStat(runs, (r) => r.model).map<ModelStat>(
    ([model, list]) => ({
      model,
      runs: list.length,
      pass_rate: list.filter((r) => r.passed).length / list.length,
      avg_reward: list.reduce((s, r) => s + r.reward, 0) / list.length,
      cost_usd: list.reduce((s, r) => s + r.cost_usd, 0),
      avg_cache_hit_rate:
        list.reduce((s, r) => s + r.cache_hit_rate, 0) / list.length,
      avg_cost_per_run:
        list.reduce((s, r) => s + r.cost_usd, 0) / list.length,
      avg_latency_ms:
        list.reduce((s, r) => s + r.latency_ms, 0) / list.length,
      tokens: list.reduce((s, r) => s + tokensOf(r), 0),
    })
  );

  const byTask = groupStat(runs, (r) => r.task_id).map<TaskStat>(
    ([taskId, list]) => ({
      task_id: taskId,
      title: list[0].task_title,
      difficulty: list[0].difficulty,
      runs: list.length,
      pass_rate: list.filter((r) => r.passed).length / list.length,
      avg_reward: list.reduce((s, r) => s + r.reward, 0) / list.length,
      avg_steps: list.reduce((s, r) => s + r.steps, 0) / list.length,
    })
  );

  const byDiff = groupStat(runs, (r) => r.difficulty).map<DifficultyStat>(
    ([difficulty, list]) => ({
      difficulty,
      runs: list.length,
      pass_rate: list.filter((r) => r.passed).length / list.length,
      avg_reward: list.reduce((s, r) => s + r.reward, 0) / list.length,
    })
  );

  // reward histogram in 10 buckets [0,0.1),...,[0.9,1.0]
  const hist = new Array(10).fill(0);
  for (const r of runs) {
    const idx = Math.min(9, Math.max(0, Math.floor(r.reward * 10)));
    hist[idx] += 1;
  }

  // cost grouped by calendar day
  const byDay = new Map<string, { cost: number; runs: number }>();
  for (const r of runs) {
    const day = r.started_at.slice(0, 10);
    const cur = byDay.get(day) ?? { cost: 0, runs: 0 };
    cur.cost += r.cost_usd;
    cur.runs += 1;
    byDay.set(day, cur);
  }
  const costOverTime = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ts, v]) => ({ ts, cost: Number(v.cost.toFixed(4)), runs: v.runs }));

  return {
    total_runs: runs.length,
    pass_rate: passes / total,
    total_cost_usd: Number(totalCost.toFixed(4)),
    total_tokens: totalTokens,
    avg_cache_hit_rate: Number(avgCache.toFixed(4)),
    total_retries: totalRetries,
    avg_latency_ms: Math.round(avgLatency),
    by_model: byModel.sort((a, b) => b.runs - a.runs),
    by_task: byTask.sort((a, b) => a.difficulty.localeCompare(b.difficulty)),
    by_difficulty: byDiff.sort(
      (a, b) => orderDiff(a.difficulty) - orderDiff(b.difficulty)
    ),
    reward_histogram: hist,
    cost_over_time: costOverTime,
  };
}

function orderDiff(d: string): number {
  return d === "easy" ? 0 : d === "medium" ? 1 : 2;
}

function groupStat<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k) ?? [];
    list.push(it);
    map.set(k, list);
  }
  return [...map.entries()];
}
