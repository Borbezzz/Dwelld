import { errorResponse } from "@/lib/server/api-error";
import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ inspectionId: string; findingId: string }> }) {
  const { inspectionId, findingId } = await params;
  const inspectionObjectId = parseObjectId(inspectionId);
  const findingObjectId = parseObjectId(findingId);
  if (!inspectionObjectId || !findingObjectId) return NextResponse.json({ error: "Inspection or finding not found" }, { status: 404 });
  try {
    const body = await request.json() as { reviewStatus?: unknown };
    if (body.reviewStatus !== "pending" && body.reviewStatus !== "confirmed" && body.reviewStatus !== "rejected") {
      return NextResponse.json({ error: "reviewStatus must be pending, confirmed, or rejected" }, { status: 400 });
    }
    const db = await getDb();
    const updated = await db.collection("findings").findOneAndUpdate(
      { _id: findingObjectId, inspectionId: inspectionObjectId },
      [{
        $set: {
          reviewStatus: body.reviewStatus,
          reviewedAt: "$$NOW",
          reviewHistory: { $concatArrays: [
            { $ifNull: ["$reviewHistory", []] },
            [{ from: { $ifNull: ["$reviewStatus", "pending"] }, to: body.reviewStatus, at: "$$NOW" }],
          ] },
        },
      }],
      { returnDocument: "after" },
    );
    if (!updated) return NextResponse.json({ error: "Finding not found" }, { status: 404 });
    return NextResponse.json({ finding: {
      id: String(updated._id), kind: updated.kind, label: updated.label, description: updated.description,
      timestampSeconds: updated.timestampSeconds, evidenceFrameUrl: updated.evidenceFrameUrl,
      detectionSource: updated.detectionSource === "yolo" || updated.detectionSource === "gemini" ? updated.detectionSource : undefined,
      boundingBox: updated.boundingBox ?? null, point: updated.point ?? null, source: updated.source ?? "ai", damageType: updated.damageType ?? null, reviewStatus: updated.reviewStatus,
      uncertain: !updated.boundingBox && !updated.point, objectId: updated.objectId ? String(updated.objectId) : null,
      objectLabel: updated.objectLabel ?? null,
    } });
  } catch (error) {
    return errorResponse(error, "app/api/inspections/[inspectionId]/findings/[findingId]/route.ts");
  }
}
