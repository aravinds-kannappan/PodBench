import { promises as fs } from "fs";
import path from "path";
import type { Fleet, Run } from "../types";

// Live runs executed in this process are kept in module memory and merged in
// front of the recorded dataset. On a long-lived server (the worker, local dev)
// this accumulates; on serverless it is per-instance, which is fine because the
// recorded dataset is the durable history.
const liveRuns: Run[] = [];

let runsCache: Run[] | null = null;
let fleetCache: Fleet | null = null;

async function readJson<T>(file: string): Promise<T> {
  const full = path.join(process.cwd(), "data", file);
  const raw = await fs.readFile(full, "utf8");
  return JSON.parse(raw) as T;
}

export async function loadRecordedRuns(): Promise<Run[]> {
  if (!runsCache) {
    runsCache = await readJson<Run[]>("runs.json");
  }
  return runsCache;
}

export async function getRuns(): Promise<Run[]> {
  const recorded = await loadRecordedRuns();
  const merged = [...liveRuns, ...recorded];
  return merged.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export async function getRun(id: string): Promise<Run | undefined> {
  const live = liveRuns.find((r) => r.id === id);
  if (live) return live;
  const recorded = await loadRecordedRuns();
  return recorded.find((r) => r.id === id);
}

export function recordLiveRun(run: Run): void {
  liveRuns.unshift(run);
  if (liveRuns.length > 200) liveRuns.length = 200;
}

export async function getFleet(): Promise<Fleet> {
  if (!fleetCache) {
    fleetCache = await readJson<Fleet>("fleet.json");
  }
  return fleetCache;
}

// Aggregation lives in lib/stats.ts so the same pure logic can run on the
// server and inside client components. Re-exported here for existing callers.
export {
  computeStats,
  type Stats,
  type ModelStat,
  type TaskStat,
  type DifficultyStat,
} from "../stats";
