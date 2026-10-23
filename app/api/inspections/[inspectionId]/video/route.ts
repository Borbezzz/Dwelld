import { get as getBlob } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  const id = parseObjectId(inspectionId);
  if (!id) return new NextResponse("Not found", { status: 404 });
  try {
    const inspection = await (await getDb()).collection("inspections").findOne({ _id: id }, { projection: { sourceUrl: 1, videoMimeType: 1 } });
    if (!inspection || typeof inspection.sourceUrl !== "string") return new NextResponse("Not found", { status: 404 });
    const blobUrl = new URL(inspection.sourceUrl);
    if (blobUrl.protocol !== "https:" || !blobUrl.hostname.endsWith(".private.blob.vercel-storage.com")) return new NextResponse("Not found", { status: 404 });
    const blob = await getBlob(decodeURIComponent(blobUrl.pathname.slice(1)), { access: "private" });
    if (!blob || blob.statusCode !== 200) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(blob.stream, {
      headers: {
        "Content-Type": inspection.videoMimeType || blob.blob.contentType || "application/octet-stream",
        "Content-Length": String(blob.blob.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "none",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read video";
    return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid request body" : "The service could not complete this request. Check server configuration and try again." }, { status: error instanceof SyntaxError ? 400 : message.includes("not configured") ? 503 : 500 });
  }
}
