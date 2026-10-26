import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { buildBootstrap } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date");
  const tz = req.nextUrl.searchParams.get("tz");
  const data = await buildBootstrap(user, date, tz);
  return NextResponse.json(data);
}
