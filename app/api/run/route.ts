import { NextResponse } from "next/server";
import { runEpisode } from "@/lib/agent/runner";
import { recordLiveRun } from "@/lib/data/store";
import { getTask } from "@/lib/env/tasks";
import { hasCredentials, credentialHint } from "@/lib/agent/llm";

import { isPromptCondition } from "@/lib/agent/probe-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!hasCredentials()) {
    return NextResponse.json({ error: credentialHint() }, { status: 400 });
  }

  let body: { task_id?: string; model?: string; effort?: string; prompt_condition?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const condition = body?.prompt_condition === undefined ? "baseline" : body.prompt_condition;
  if (!isPromptCondition(condition)) {
    return NextResponse.json({ error: "unknown prompt_condition" }, { status: 400 });
  }
  const taskId = body?.task_id;
  if (!taskId || !getTask(taskId)) {
    return NextResponse.json({ error: "unknown or missing task_id" }, { status: 400 });
  }

  try {
    const run = await runEpisode(taskId, {
      model: body.model,
      promptCondition: condition,
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
