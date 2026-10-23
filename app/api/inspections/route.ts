import { errorResponse, reportError } from "@/lib/server/api-error";
import { ObjectId } from "mongodb";
import { parseMediaId, getMediaFile } from "@/lib/server/media";
import { after, NextResponse } from "next/server";
import { getDb, ensureIndexes, parseObjectId } from "@/lib/server/db";
import { analyzeVideo, validateDetectionFrames } from "@/lib/server/inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;


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
  } catch (error) { return errorResponse(error, "app/api/inspections/route.ts"); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { roomId?: unknown; videoUrl?: unknown; videoMimeType?: unknown; detectionFrames?: unknown };
    const roomId = typeof body.roomId === "string" ? parseObjectId(body.roomId) : null;
    const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";
    const mimeType = typeof body.videoMimeType === "string" ? body.videoMimeType.split(";")[0].trim().toLowerCase() : "";
    if (!roomId) return NextResponse.json({ error: "A valid roomId is required" }, { status: 400 });
    if (!videoUrl || videoUrl.length > 2048) return NextResponse.json({ error: "A videoUrl is required" }, { status: 400 });

    if (!["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"].includes(mimeType)) {
      return NextResponse.json({ error: "Unsupported video format" }, { status: 415 });
    }
    if (!parseMediaId(videoUrl)) return NextResponse.json({ error: "Video must refer to a MongoDB media upload" }, { status: 400 });
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "Video inspection is unavailable: Gemini is not configured" }, { status: 503 });
    }
    const media = await getMediaFile(videoUrl);
    if (!media || media.metadata?.contentType !== mimeType) return NextResponse.json({ error: "Uploaded video not found or content type mismatch" }, { status: 400 });
    let detectionFrames;
    try { detectionFrames = validateDetectionFrames(body.detectionFrames); }
    catch { return NextResponse.json({ error: "Invalid browser detection frames" }, { status: 400 }); }
    const db = await getDb();
    await ensureIndexes(db);
    const room = await db.collection("rooms").findOne({ _id: roomId }, { projection: { _id: 1 } });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const inspections = db.collection("inspections");
    const inspectionId = new ObjectId();
    const createdAt = new Date();
    const inspectionDoc = {
      _id: inspectionId, roomId, type: "move-in", sourceUrl: videoUrl, videoMimeType: mimeType,
      status: "processing", createdAt, durationSeconds: null, detector: "yolo11n-coco", detectionFrames,
    };
    await inspections.insertOne(inspectionDoc);

    after(async () => {
      try {
        const result = await analyzeVideo(videoUrl, mimeType, detectionFrames);
        // Every observation has its own identity, including objects sharing a label.
        const ids = result.findings.map(() => new ObjectId());
        const objectIds = new Map<string, ObjectId>();
        result.findings.forEach((finding, index) => {
          if (finding.kind === "object" && finding.detectionId) objectIds.set(finding.detectionId, ids[index]);
        });
        const docs = result.findings.map((finding, index) => ({
          _id: ids[index], inspectionId, roomId, ...finding,
          objectId: finding.parentDetectionId ? objectIds.get(finding.parentDetectionId) || null : null,
          source: "ai", reviewStatus: "pending", reviewHistory: [], createdAt: new Date(),
        }));
        if (docs.length) await db.collection("findings").insertMany(docs);
        await inspections.updateOne({ _id: inspectionId }, { $set: { status: result.warnings.length ? "partial" : "completed", analysisWarnings: result.warnings, durationSeconds: result.durationSeconds, completedAt: new Date() } });
      } catch (error) {
        const failure = reportError(error, "inspection.analyze");
        const message = `${failure.error} Request ID: ${failure.requestId}`;
        await inspections.updateOne({ _id: inspectionId }, { $set: { status: "failed", error: message, failedAt: new Date() } });
      }
    });
    return NextResponse.json({
      inspection: { id: String(inspectionId), roomId: String(roomId), status: "processing", createdAt: createdAt.toISOString(), videoUrl: "/api/inspections/" + String(inspectionId) + "/video" },
    }, { status: 201 });
  } catch (error) { return errorResponse(error, "app/api/inspections/route.ts"); }
}
