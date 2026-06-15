import { NextResponse } from "next/server";
import { getFleet } from "@/lib/data/store";

export const runtime = "nodejs";

export async function GET() {
  const fleet = await getFleet();
  return NextResponse.json(fleet);
}
