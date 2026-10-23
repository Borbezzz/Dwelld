import { mediaResponse, parseMediaId } from "@/lib/server/media";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw || raw.length > 2048) return new NextResponse("Missing media URL", { status: 400 });
  try {
    if (!parseMediaId(raw)) return new NextResponse("Not found", { status: 404 });
    const db = await getDb();
    const registered = await db.collection("inspections").findOne({ sourceUrl: raw }, { projection: { _id: 1 } })
      || await db.collection("findings").findOne({ evidenceFrameUrl: raw }, { projection: { _id: 1 } });
    if (!registered) return new NextResponse("Not found", { status: 404 });
    return await mediaResponse(raw, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read media";
    return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid request body" : "The service could not complete this request. Check server configuration and try again." }, { status: error instanceof SyntaxError ? 400 : message.includes("not configured") ? 503 : 500 });
  }
}
