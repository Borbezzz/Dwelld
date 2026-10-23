import { get as getBlob } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw || raw.length > 2048) return new NextResponse("Missing media URL", { status: 400 });
  try {
    const source = new URL(raw);
    if (source.protocol !== "https:" || !source.hostname.endsWith(".private.blob.vercel-storage.com")) {
      return new NextResponse("Not found", { status: 404 });
    }
    const registered = await (await getDb()).collection("inspections").findOne({ sourceUrl: raw }, { projection: { _id: 1 } });
    if (!registered) return new NextResponse("Not found", { status: 404 });
    const blob = await getBlob(decodeURIComponent(source.pathname.slice(1)), { access: "private" });
    if (!blob || blob.statusCode !== 200) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(blob.stream, {
      headers: {
        "Content-Type": blob.blob.contentType || "application/octet-stream",
        "Content-Length": String(blob.blob.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "none",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read media";
    return NextResponse.json({ error: message }, { status: message.includes("not configured") ? 503 : 500 });
  }
}
