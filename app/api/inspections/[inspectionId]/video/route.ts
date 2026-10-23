import { mediaResponse, parseMediaId } from "@/lib/server/media";
import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  const id = parseObjectId(inspectionId);
  if (!id) return new NextResponse("Not found", { status: 404 });
  try {
    const inspection = await (await getDb()).collection("inspections").findOne({ _id: id }, { projection: { sourceUrl: 1, videoMimeType: 1 } });
    if (!inspection || typeof inspection.sourceUrl !== "string") return new NextResponse("Not found", { status: 404 });
    if (!parseMediaId(inspection.sourceUrl)) return new NextResponse("Not found", { status: 404 });
    return await mediaResponse(inspection.sourceUrl, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read video";
    return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid request body" : "The service could not complete this request. Check server configuration and try again." }, { status: error instanceof SyntaxError ? 400 : message.includes("not configured") ? 503 : 500 });
  }
}
