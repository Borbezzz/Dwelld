import { sealLater } from "@/lib/server/ledger";
import {readJsonBody} from "@/lib/server/request-body";
import { canReadRoom } from "@/lib/server/space-access";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { ObjectId } from "mongodb";
import { parseMediaId, getMediaFile } from "@/lib/server/media";
import { after, NextResponse } from "next/server";
import { getDb, ensureIndexes, parseObjectId } from "@/lib/server/db";
import { validateDetectionFrames } from "@/lib/server/inspection";
import { runVideoInspection } from "@/lib/server/run-video-inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;


function serializeInspection(doc: Record<string, any>, viewerId: string) {
  return {
    id: String(doc._id), roomId: String(doc.roomId), status: doc.status, type: doc.type || "move-in", isOwner: doc.ownerId===viewerId,
    createdAt: new Date(doc.createdAt).toISOString(),
    ...(typeof doc.sourceUrl === "string" ? { videoUrl: "/api/inspections/" + String(doc._id) + "/video" } : {}),
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const roomParam = url.searchParams.get("roomId");
    const roomId = roomParam ? parseObjectId(roomParam) : null;
    if (roomParam && !roomId) return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
    const db = await getDb();
    await ensureIndexes(db);
    const memberships=await db.collection("spaceMembers").find({userId:user.id},{projection:{spaceId:1}}).toArray();
    const ownedSpaces=await db.collection("spaces").find({ownerId:user.id},{projection:{_id:1}}).toArray();
    const visibleSpaceIds=[...ownedSpaces.map(s=>s._id),...memberships.map(m=>m.spaceId)];
    const sharedRooms=visibleSpaceIds.length?await db.collection("rooms").find({spaceId:{$in:visibleSpaceIds}},{projection:{_id:1}}).toArray():[];
    const accessible=[...sharedRooms.map(r=>r._id),...(await db.collection("rooms").find({ownerId:user.id},{projection:{_id:1}}).toArray()).map(r=>r._id)];
    const docs = await db.collection("inspections").find({$or:[{ownerId:user.id},{roomId:{$in:accessible}}],...(roomId ? {roomId} : {})}).sort({ createdAt: -1 }).limit(100).toArray();
    const segments=accessible.length?await db.collection("roomScanSegments").find({roomId:{$in:accessible},...(roomId?{roomId}:{})}).limit(100).toArray():[];
    const sources=segments.length?await db.collection("inspections").find({_id:{$in:segments.map(s=>s.sourceInspectionId)}}).toArray():[];
    const virtual=segments.flatMap(s=>{const source=sources.find(i=>String(i._id)===String(s.sourceInspectionId));if(!source||String(source.roomId)===String(s.roomId))return [];
      return [{...serializeInspection(source,user.id),roomId:String(s.roomId),virtual:true,segment:{startTime:s.startTime,endTime:s.endTime}}];
    });
    const inspections=[...docs.map(d=>serializeInspection(d,user.id)),...virtual].sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)).slice(0,100);
    return NextResponse.json({inspections},{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return errorResponse(error, "app/api/inspections/route.ts"); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJsonBody(request, 1024*1024) as { roomId?: unknown; videoUrl?: unknown; videoMimeType?: unknown; detectionFrames?: unknown; type?: unknown };
    if (body.type !== undefined && !["move-in","move-out"].includes(String(body.type))) return NextResponse.json({error:"Invalid inspection type"},{status:400});
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
    if (!media || media.metadata?.ownerId !== user.id || media.metadata?.contentType !== mimeType) return NextResponse.json({ error: "Uploaded video not found or content type mismatch" }, { status: 400 });
    let detectionFrames;
    try { detectionFrames = validateDetectionFrames(body.detectionFrames); }
    catch { return NextResponse.json({ error: "Invalid browser detection frames" }, { status: 400 }); }
    const db = await getDb();
    await ensureIndexes(db);
    const room = await db.collection("rooms").findOne({ _id: roomId });
    if (!room || !await canReadRoom(room as never,user.id)) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const inspections = db.collection("inspections");
    const inspectionId = new ObjectId();
    const createdAt = new Date();
    const inspectionDoc = {
      _id: inspectionId, ownerId:user.id, roomId, type: body.type || "move-in", sourceUrl: videoUrl, videoMimeType: mimeType,
      status: "processing", createdAt, durationSeconds: null, detector: "yolo11n-coco", detectionFrames,
    };
    await inspections.insertOne(inspectionDoc);

    // Seal the original recording before anything else touches it.
    after(() => sealLater(inspectionId));
    after(() => runVideoInspection(db, inspectionId, user.id, roomId, videoUrl, mimeType, detectionFrames));
    return NextResponse.json({
      inspection: { id: String(inspectionId), roomId: String(roomId), status: "processing", createdAt: createdAt.toISOString(), videoUrl: "/api/inspections/" + String(inspectionId) + "/video" },
    }, { status: 201 });
  } catch (error) { return errorResponse(error, "app/api/inspections/route.ts"); }
}
