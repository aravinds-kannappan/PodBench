import { NextResponse } from "next/server";
import { getRuns } from "@/lib/data/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "0");
  const task = url.searchParams.get("task");
  const model = url.searchParams.get("model");

  let runs = await getRuns();
  if (task) runs = runs.filter((r) => r.task_id === task);
  if (model) runs = runs.filter((r) => r.model === model);
  if (limit > 0) runs = runs.slice(0, limit);

  // Trajectories can be large; omit them from the list view.
  const slim = runs.map(({ trajectory, ...rest }) => rest);
  return NextResponse.json({ count: slim.length, runs: slim });
}
