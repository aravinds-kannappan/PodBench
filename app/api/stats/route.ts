import { NextResponse } from "next/server";
import { getRuns, computeStats } from "@/lib/data/store";

export const runtime = "nodejs";

export async function GET() {
  const runs = await getRuns();
  return NextResponse.json(computeStats(runs));
}
