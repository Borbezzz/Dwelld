import { after } from "next/server";
import { authenticateLive, liveCollections, liveFailure, LiveError } from "@/lib/server/live-sessions";
import { readJsonBody } from "@/lib/server/request-body";
import { getMediaFile } from "@/lib/server/media";
import { analyzeLiveEvidenceFrame } from "@/lib/server/native-analysis";
import { validPose } from "@/lib/server/native-live";
export const runtime = "nodejs"; export const maxDuration = 300;

/** The phone uploaded a sharp evidence photo mid-scan: analyse it now, against the furniture RoomPlan has measured. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { session } = await authenticateLive(request, (await params).sessionId, "phone");
    if (session.status === "saved") return Response.json({ saved: true });
    const b = await readJsonBody(request, 32 * 1024), pose = validPose(b.pose);
    if (typeof b.name !== "string" || !/^[\w.-]{1,120}$/.test(b.name) || typeof b.ref !== "string" || !/^gridfs:[a-f0-9]{24}$/.test(b.ref) || !pose || !Number.isFinite(b.timestampSeconds)) throw new LiveError("Invalid frame");
    const file = await getMediaFile(b.ref);
    if (file?.metadata?.liveSessionId !== String(session._id)) throw new LiveError("Frame does not belong to this scan", 403);
    const { db } = await liveCollections();
    const inserted = await db.collection("liveFrames").updateOne({ sessionId: session._id, name: b.name }, { $setOnInsert: { sessionId: session._id, name: b.name, ref: b.ref, pose, timestampSeconds: b.timestampSeconds, status: "queued", createdAt: new Date() } }, { upsert: true });
    if (inserted.upsertedCount) after(() => analyzeLiveEvidenceFrame(session._id, b.name));
    return Response.json({ queued: !!inserted.upsertedCount }, { status: 202 });
  } catch (e) { return liveFailure(e); }
}
