import { NextResponse } from "next/server";
import { runEpisode } from "@/lib/agent/runner";
import { recordLiveRun } from "@/lib/data/store";
import { getTask } from "@/lib/env/tasks";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set. Add it to your environment to execute live runs.",
      },
      { status: 400 }
    );
  }

  let body: { task_id?: string; model?: string; effort?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const taskId = body.task_id;
  if (!taskId || !getTask(taskId)) {
    return NextResponse.json({ error: "unknown or missing task_id" }, { status: 400 });
  }

  try {
    const run = await runEpisode(taskId, {
      model: body.model,
      effort: body.effort,
      queue: "redis",
    });
    recordLiveRun(run);
    return NextResponse.json(run);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "run failed" },
      { status: 500 }
    );
  }
}
