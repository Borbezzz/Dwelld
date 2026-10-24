import { Binary } from "mongodb";
import { authenticateLive, liveCollections, liveFailure, LiveError } from "@/lib/server/live-sessions";
import { readJsonBody } from "@/lib/server/request-body";
import { validElements } from "@/lib/server/native-live";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ sessionId: string }> };

/**
 * Live room stream. The phone posts only the LiDAR points it has not sent yet (9 bytes each) plus
 * RoomPlan's latest furniture, about once a second; the laptop pulls everything after its cursor.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { session } = await authenticateLive(request, (await params).sessionId, "phone");
    if (session.status === "saved") return Response.json({ saved: true });
    const b = await readJsonBody(request, 300 * 1024);
    if (typeof b.points !== "string" || b.points.length > 200_000 || !/^[A-Za-z0-9+/=]*$/.test(b.points)) throw new LiveError("Invalid stream chunk");
    const bytes = Buffer.from(b.points, "base64"); if (bytes.length % 9) throw new LiveError("Invalid stream chunk");
    const elements = b.elements === undefined ? undefined : validElements(b.elements);
    const { db, sessions } = await liveCollections();
    const next = await sessions.findOneAndUpdate({ _id: session._id }, { $inc: { streamSeq: 1 }, $set: { nativeCapture: true, ...(elements ? { "nativeLive.elements": elements } : {}), "nativeLive.updatedAt": new Date().toISOString() } }, { returnDocument: "after" });
    const seq = (next as unknown as { streamSeq?: number } | null)?.streamSeq ?? 0;
    if (bytes.length) await db.collection("liveStream").insertOne({ sessionId: session._id, seq, points: new Binary(bytes), count: bytes.length / 9, createdAt: new Date(), expiresAt: new Date(Date.now() + 6 * 3600_000) });
    return Response.json({ seq, stopRequested: !!session.stopRequested });
  } catch (e) { return liveFailure(e); }
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { session } = await authenticateLive(request, (await params).sessionId, "desktop");
    const after = Math.max(0, Number(new URL(request.url).searchParams.get("after")) || 0);
    const { db } = await liveCollections();
    await db.collection("liveStream").createIndex({ sessionId: 1, seq: 1 });
    await db.collection("liveStream").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    const rows = await db.collection("liveStream").find({ sessionId: session._id, seq: { $gt: after } }, { projection: { _id: 0, seq: 1, points: 1 } }).sort({ seq: 1 }).limit(60).toArray();
    return Response.json({ chunks: rows.map(r => ({ seq: r.seq, points: Buffer.from((r.points as Binary).buffer).toString("base64") })), elements: session.nativeLive?.elements ?? [], saved: session.status === "saved" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return liveFailure(e); }
}
