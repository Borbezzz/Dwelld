import { requireReadableInspection } from "@/lib/server/space-access";
import { reconstructionFor } from "@/lib/server/object-reconstruction";
import { errorResponse } from "@/lib/server/api-error";
import { requireUser } from "@/lib/server/access";
import { parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The selected piece, rebuilt from this inspection's calibrated photos. */
export async function GET(request: Request, { params }: { params: Promise<{ inspectionId: string; elementId: string }> }) {
  try {
    const user = await requireUser(request);
    const { inspectionId, elementId } = await params;
    const id = parseObjectId(inspectionId);
    if (!id || !elementId || elementId.length > 80) return Response.json({ error: "Inspection not found" }, { status: 404 });
    const inspection = await requireReadableInspection(id, user.id);
    const cloud = await reconstructionFor(inspection, elementId);
    if (!cloud) return Response.json({ error: "This piece could not be reconstructed from the inspection photos." }, { status: 404 });
    return Response.json(cloud, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error, "spatial.object-reconstruction"); }
}
