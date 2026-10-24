import { requireUser, requireOwnedInspection } from "@/lib/server/access";
import { deleteInspection } from "@/lib/server/delete";
import { errorResponse } from "@/lib/server/api-error";
import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  const id = parseObjectId(inspectionId);
  if (!id) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  try {
    const user = await requireUser(request);
    const db = await getDb();
    const inspection = await db.collection("inspections").findOne({ _id: id, ownerId:user.id });
    if (!inspection) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
    const findings = await db.collection("findings").find({ inspectionId: id }).sort({ createdAt: 1 }).toArray();
    const serializedFindings = findings.map((f) => ({
      id: String(f._id), kind: f.kind, label: f.label, description: f.description,
      timestampSeconds: f.timestampSeconds, evidenceFrameUrl: f.evidenceFrameUrl,
      detectionSource: f.detectionSource === "yolo" || f.detectionSource === "gemini" || f.detectionSource === "crack-model" ? f.detectionSource : undefined,
      boundingBox: f.boundingBox ?? null, point: f.point ?? null, source: f.source ?? "ai", damageType: f.damageType ?? null, reviewStatus: f.reviewStatus, uncertain: !f.boundingBox && !f.point,
      objectId: f.objectId ? String(f.objectId) : null, objectLabel: f.objectLabel ?? null, spatialElementId: f.spatialElementId ?? null, confidence: typeof f.confidence === "number" ? f.confidence : null, autoApproved: !!f.autoApproved, verification: f.verification ? { verdict: f.verification.verdict, confidence: f.verification.confidence, reason: f.verification.reason } : null,
    }));
    return NextResponse.json({
      inspection: {
        id: String(inspection._id), roomId: String(inspection.roomId), status: inspection.status, type: inspection.type || "move-in",
        createdAt: new Date(inspection.createdAt).toISOString(),
        videoUrl: typeof inspection.sourceUrl === "string" ? "/api/inspections/" + String(inspection._id) + "/video" : undefined,
        durationSeconds: inspection.durationSeconds ?? null,
        analysisWarnings: inspection.analysisWarnings ?? [],
        evidenceFrames: inspection.evidenceFrames ?? [],
        analysisRunId: inspection.analysisRunId ?? null,
        analysisProgress: inspection.analysisProgress ?? null,
        error: inspection.status === "failed" ? "Video analysis failed. Check service configuration and retry with a supported video." : null,
      },
      findings: serializedFindings,
    });
  } catch (error) {
    return errorResponse(error, "app/api/inspections/[inspectionId]/route.ts");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  try {
    const user = await requireUser(request);
    const inspection = await requireOwnedInspection((await params).inspectionId, user.id);
    if (inspection.status === "processing" || inspection.status === "queued") {
      const started = new Date(inspection.updatedAt || inspection.createdAt).getTime();
      if (Date.now() - started < 10 * 60_000) return NextResponse.json({ error: "This scan is still being analysed. Try deleting it in a few minutes." }, { status: 409 });
    }
    return NextResponse.json({ deleted: true, ...(await deleteInspection(inspection)) });
  } catch (error) { return errorResponse(error, "inspection.delete"); }
}
