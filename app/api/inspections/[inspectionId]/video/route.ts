import { requireReadableInspection } from "@/lib/server/space-access";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { mediaResponse, parseMediaId } from "@/lib/server/media";
import { NextResponse } from "next/server";
import { parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  const id = parseObjectId(inspectionId);
  if (!id) return new NextResponse("Not found", { status: 404 });
  try {
    const user = await requireUser(request);
    const inspection = await requireReadableInspection(id,user.id);
    if (!inspection || typeof inspection.sourceUrl !== "string") return new NextResponse("Not found", { status: 404 });
    if (!parseMediaId(inspection.sourceUrl)) return new NextResponse("Not found", { status: 404 });
    return await mediaResponse(inspection.sourceUrl, request);
  } catch (error) {
    return errorResponse(error, "app/api/inspections/[inspectionId]/video/route.ts");
  }
}
