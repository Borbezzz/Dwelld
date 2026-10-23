import { ObjectId } from "mongodb";
import { after, NextResponse } from "next/server";
import { getDb, ensureIndexes, parseObjectId } from "@/lib/server/db";
import { analyzeVideo } from "@/lib/server/inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The request could not be completed";
  const status = message.includes("not configured") || message.includes("unavailable") ? 503 : 500;
  return NextResponse.json({ error: message }, { status });
}

function serializeInspection(doc: Record<string, any>) {
  return {
    id: String(doc._id), roomId: String(doc.roomId), status: doc.status,
    createdAt: new Date(doc.createdAt).toISOString(),
    videoUrl: "/api/inspections/" + String(doc._id) + "/video",
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const roomParam = url.searchParams.get("roomId");
    const roomId = roomParam ? parseObjectId(roomParam) : null;
    if (roomParam && !roomId) return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
    const db = await getDb();
    await ensureIndexes(db);
    const docs = await db.collection("inspections").find(roomId ? { roomId } : {}).sort({ createdAt: -1 }).limit(100).toArray();
    return NextResponse.json({ inspections: docs.map(serializeInspection) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { roomId?: unknown; videoUrl?: unknown; videoMimeType?: unknown };
    const roomId = typeof body.roomId === "string" ? parseObjectId(body.roomId) : null;
    const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";
    const mimeType = typeof body.videoMimeType === "string" ? body.videoMimeType : "";
    if (!roomId) return NextResponse.json({ error: "A valid roomId is required" }, { status: 400 });
    if (!videoUrl || videoUrl.length > 2048) return NextResponse.json({ error: "A videoUrl is required" }, { status: 400 });

    const db = await getDb();
    await ensureIndexes(db);
    const room = await db.collection("rooms").findOne({ _id: roomId }, { projection: { _id: 1 } });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const inspections = db.collection("inspections");
    const inspectionId = new ObjectId();
    const createdAt = new Date();
    const inspectionDoc = {
      _id: inspectionId, roomId, type: "move-in", sourceUrl: videoUrl, videoMimeType: mimeType,
      status: "processing", createdAt, durationSeconds: null,
    };
    await inspections.insertOne(inspectionDoc);

    after(async () => {
      try {
        const result = await analyzeVideo(videoUrl, mimeType);
        const objectIds = new Map(result.findings.filter((f) => f.kind === "object").map((f) => [f.label.toLowerCase(), new ObjectId()]));
        const docs = result.findings.map((finding) => {
          const id = finding.kind === "object" ? objectIds.get(finding.label.toLowerCase()) : undefined;
          const objectId = finding.kind === "damage" && finding.objectLabel ? objectIds.get(finding.objectLabel.toLowerCase()) : undefined;
          return {
            _id: id || new ObjectId(), inspectionId, roomId, ...finding,
            objectId: objectId || null, reviewStatus: "pending", createdAt: new Date(),
          };
        });
        if (docs.length) await db.collection("findings").insertMany(docs);
        await inspections.updateOne({ _id: inspectionId }, { $set: { status: "completed", durationSeconds: result.durationSeconds, completedAt: new Date() } });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gemini analysis failed";
        await inspections.updateOne({ _id: inspectionId }, { $set: { status: "failed", error: message, failedAt: new Date() } });
      }
    });
    return NextResponse.json({
      inspection: { id: String(inspectionId), roomId: String(roomId), status: "processing", createdAt: createdAt.toISOString(), videoUrl: "/api/inspections/" + String(inspectionId) + "/video" },
    }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
