import sharp from "sharp";
import type { LiveFinding } from "@/lib/live/types";
import { authenticateLive, liveCollections, liveFailure, LiveError, recordLiveAnalysis, validEventId } from "@/lib/server/live-sessions";
import { writeMedia } from "@/lib/server/media";
import { describeAtPoint } from "@/lib/server/damage";
export const runtime = "nodejs"; export const maxDuration = 60;

/**
 * A mark from the phone: the photo it saw and the 3D point under its centre crosshair, measured
 * with LiDAR. Gemini describes what is at the crosshair; the mark keeps its real-world position.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params; const { session } = await authenticateLive(request, sessionId, "phone");
    if (session.status === "saved") throw new LiveError("This scan is already saved", 409);
    if (Number(request.headers.get("content-length")) > 6 * 1024 * 1024) throw new LiveError("Photo too large", 413);
    const form = await request.formData(), file = form.get("image"), data = JSON.parse(String(form.get("metadata") || "{}"));
    const position = data.position, point = data.point ?? {x:.5,y:.5};
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024 || !validEventId(data.observationId) || (position != null && (!Array.isArray(position) || position.length !== 3 || !position.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100))) || ![point.x,point.y].every((v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1) || !Number.isFinite(data.timestampSeconds) || data.timestampSeconds < 0) throw new LiveError("Invalid mark");
    const { db } = await liveCollections();
    const existing = await db.collection("liveFindings").findOne({ sessionId: session._id, id: data.observationId }, { projection: { _id: 0, sessionId: 0 } });
    if (existing) return Response.json({ finding: existing });
    const {data:image,info} = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 24_000_000 }).rotate().jpeg({ quality: 88 }).toBuffer({resolveWithObject:true});
    if ((data.imageWidth != null && data.imageWidth !== info.width) || (data.imageHeight != null && data.imageHeight !== info.height)) throw new LiveError("Snapshot dimensions do not match the marked frame");
    const ref = await writeMedia(image, `live/${sessionId}/mark-${data.observationId}.jpg`, "image/jpeg", { ownerId: session.ownerId, liveSessionId: String(session._id) });
    const seen = await describeAtPoint(image, point).catch(() => null);
    const finding: LiveFinding = {
      id: data.observationId, kind: "damage", source: "manual",
      label: seen ? seen.label : "Marked on phone",
      description: seen?.description || "Marked during the scan. Add a note if it needs one.",
      point, ...(seen?.boundingBox ? { boundingBox: seen.boundingBox } : {}),
      timestampSeconds: data.timestampSeconds, ...(position ? {worldPosition: position as [number, number, number]} : {}),
    };
    await recordLiveAnalysis(session, data.observationId, { evidenceFrameRef: ref, findings: [finding] });
    // The person chose to mark it, so it does not wait in the review queue.
    await db.collection("liveFindings").updateOne({ sessionId: session._id, id: data.observationId }, { $set: { reviewStatus: "confirmed" } });
    return Response.json({ finding: { ...finding, evidenceFrameRef: ref, reviewStatus: "confirmed" } }, { status: 201 });
  } catch (e) { return liveFailure(e); }
}
