import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  const id = parseObjectId(inspectionId);
  if (!id) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  try {
    const db = await getDb();
    const inspection = await db.collection("inspections").findOne({ _id: id });
    if (!inspection) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
    const findings = await db.collection("findings").find({ inspectionId: id }).sort({ createdAt: 1 }).toArray();
    const serializedFindings = findings.map((f) => ({
      id: String(f._id), kind: f.kind, label: f.label, description: f.description,
      timestampSeconds: f.timestampSeconds, evidenceFrameUrl: f.evidenceFrameUrl,
      boundingBox: f.boundingBox ?? null, reviewStatus: f.reviewStatus, uncertain: !f.boundingBox,
      objectId: f.objectId ? String(f.objectId) : null, objectLabel: f.objectLabel ?? null,
    }));
    return NextResponse.json({
      inspection: {
        id: String(inspection._id), roomId: String(inspection.roomId), status: inspection.status,
        createdAt: new Date(inspection.createdAt).toISOString(),
        videoUrl: "/api/inspections/" + String(inspection._id) + "/video",
        durationSeconds: inspection.durationSeconds ?? null,
        error: inspection.error ?? null,
      },
      findings: serializedFindings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load inspection";
    return NextResponse.json({ error: message }, { status: message.includes("not configured") ? 503 : 500 });
  }
}
