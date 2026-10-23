import {readJsonBody} from "@/lib/server/request-body";
import {after} from "next/server";
import {indexFindings} from "@/lib/server/search";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const inspectionId = parseObjectId((await params).inspectionId);
  if (!inspectionId) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  try {
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const evidenceId = typeof body?.evidenceFindingId === "string" ? parseObjectId(body.evidenceFindingId) : null;
    const point = body?.point;
    if (!description || description.length > 1000 || !evidenceId || !point ||
        ![point.x, point.y].every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) {
      return NextResponse.json({ error: "Provide a description, evidence finding, and point within the frame" }, { status: 400 });
    }
    const db = await getDb();
    const inspection = await db.collection("inspections").findOne({ _id: inspectionId, ownerId:user.id, status: { $in: ["completed", "partial"] } });
    const evidence = await db.collection("findings").findOne({ _id: evidenceId, inspectionId });
    if (!inspection || !evidence?.evidenceFrameUrl) return NextResponse.json({ error: "Saved evidence frame not found" }, { status: 404 });
    const objectId = body.objectId == null ? null : typeof body.objectId === "string" ? parseObjectId(body.objectId) : null;
    if (body.objectId != null && (!objectId || !await db.collection("findings").findOne({ _id: objectId, inspectionId, kind: "object" }))) {
      return NextResponse.json({ error: "Parent object must belong to this inspection" }, { status: 400 });
    }
    const doc = {
      _id: new ObjectId(), ownerId:user.id, inspectionId, roomId: inspection.roomId, kind: "damage", label: "Manual damage",
      damageType: "other", description, point: { x: point.x, y: point.y }, boundingBox: null,
      timestampSeconds: evidence.timestampSeconds, evidenceFrameUrl: evidence.evidenceFrameUrl,
      objectId, source: "manual", reviewStatus: "pending", reviewHistory: [], createdAt: new Date(),
    };
    await db.collection("findings").insertOne(doc);
    after(async()=>{await indexFindings(user.id,inspectionId).catch(()=>{});});
    return NextResponse.json({ finding: { ...doc, id: String(doc._id), _id: undefined, inspectionId: String(inspectionId), roomId: String(doc.roomId), objectId: objectId ? String(objectId) : null, uncertain: false } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "finding.create");
  }
}
