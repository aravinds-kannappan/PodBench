"use client";

// Browser-local persistence for runs the visitor executes themselves. The
// published corpus in data/runs.json is read-only and shared; this keeps each
// visitor's own runs in their browser so they show up instantly with accurate
// timestamps and survive reloads, with no server-side writable storage needed
// (which Vercel's serverless filesystem cannot provide anyway).
import type { Run } from "./types";

const KEY = "podbench.localRuns.v1";
const MAX = 300;

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): Run[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Run[]) : [];
  } catch {
    return [];
  }
}

function write(runs: Run[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(runs.slice(0, MAX)));
  } catch {
    // quota or serialization failure: drop trajectories and retry once
    try {
      const slim = runs.slice(0, MAX).map(({ trajectory, ...r }) => r);
      window.localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* give up silently; in-memory state still reflects the run */
    }
  }
  for (const l of listeners) l();
}

export function loadLocalRuns(): Run[] {
  return read().sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export function saveLocalRun(run: Run): Run[] {
  const next = [run, ...read().filter((r) => r.id !== run.id)];
  write(next);
  return next.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export function clearLocalRuns(): void {
  write([]);
}

export function subscribeLocalRuns(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
