import {readJsonBody} from "@/lib/server/request-body";
import { requireUser, requireOwnedInspection } from "@/lib/server/access";
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
    const user = await requireUser(request);
    const body = await readJsonBody(request) as { reviewStatus?: unknown };
    if (body.reviewStatus !== "pending" && body.reviewStatus !== "confirmed" && body.reviewStatus !== "rejected") {
      return NextResponse.json({ error: "reviewStatus must be pending, confirmed, or rejected" }, { status: 400 });
    }
    const db = await getDb();
    await requireOwnedInspection(inspectionObjectId,user.id);
    const updated = await db.collection("findings").findOneAndUpdate(
      { _id: findingObjectId, inspectionId: inspectionObjectId },
      [{
        $set: {
          reviewStatus: body.reviewStatus,
          reviewedAt: "$$NOW",
          reviewHistory: { $concatArrays: [
            { $ifNull: ["$reviewHistory", []] },
            [{ from: { $ifNull: ["$reviewStatus", "pending"] }, to: body.reviewStatus, at: "$$NOW", by:user.id }],
          ] },
        },
      }],
      { returnDocument: "after" },
    );
    if (!updated) return NextResponse.json({ error: "Finding not found" }, { status: 404 });
    await db.collection("spatialMarkers").updateMany({ inspectionId: inspectionObjectId, findingId: String(findingObjectId), deletedAt: { $exists: false } }, { $set: { reviewStatus: body.reviewStatus }, $inc: { version: 1 }, $push: { reviewHistory: { action: body.reviewStatus, at: new Date(), by: user.id, via: "finding" } } } as never);
    return NextResponse.json({ finding: {
      id: String(updated._id), kind: updated.kind, label: updated.label, description: updated.description,
      timestampSeconds: updated.timestampSeconds, evidenceFrameUrl: updated.evidenceFrameUrl,
      detectionSource: updated.detectionSource === "yolo" || updated.detectionSource === "gemini" || updated.detectionSource === "crack-model" || updated.detectionSource === "roomplan" ? updated.detectionSource : undefined,
      boundingBox: updated.boundingBox ?? null, point: updated.point ?? null, source: updated.source ?? "ai", damageType: updated.damageType ?? null, reviewStatus: updated.reviewStatus,
      uncertain: !updated.boundingBox && !updated.point, objectId: updated.objectId ? String(updated.objectId) : null,
      objectLabel: updated.objectLabel ?? null,
    } });
  } catch (error) {
    return errorResponse(error, "app/api/inspections/[inspectionId]/findings/[findingId]/route.ts");
  }
}
