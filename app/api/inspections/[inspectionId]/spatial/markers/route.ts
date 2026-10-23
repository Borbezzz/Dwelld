import {readJsonBody} from "@/lib/server/request-body";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { requireUser, requireOwnedInspection } from "@/lib/server/access";
import { getDb, parseObjectId } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/api-error";
import { vector } from "@/lib/server/spatial";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  try {
    const user = await requireUser(request), { inspectionId } = await params;
    const inspection = await requireOwnedInspection(inspectionId, user.id), db = await getDb();
    const b = await readJsonBody(request);
    const capture = await db.collection("spatialCaptures").findOne({ inspectionId: inspection._id });
    if (!capture) return NextResponse.json({ error: "Import a real spatial capture first" }, { status: 409 });
    if (!["add", "move", "delete", "confirm", "reject"].includes(b.action)) return NextResponse.json({ error: "Invalid marker action" }, { status: 400 });
    const now = new Date();
    if (b.action === "add") {
      if (!vector(b.position) || typeof b.label !== "string" || !b.label.trim() || b.label.length > 500 || (b.elementId != null && !capture.manifest.elements.some((e: { id: string }) => e.id === b.elementId))) return NextResponse.json({ error: "Invalid marker" }, { status: 400 });
      let findingId = null;
      if (b.findingId != null) { findingId = typeof b.findingId === "string" ? parseObjectId(b.findingId) : null; if (!findingId || !await db.collection("findings").findOne({ _id: findingId, inspectionId: inspection._id })) return NextResponse.json({ error: "Finding does not belong to this inspection" }, { status: 400 }); }
      const marker = { findingId: findingId ? String(findingId) : null, _id: new ObjectId(), inspectionId: inspection._id, ownerId: user.id, sessionId: capture.manifest.sessionId, position: b.position, label: b.label.trim(), elementId: b.elementId || null, reviewStatus: "pending", version: 1, createdAt: now, reviewHistory: [{ action: "add", position: b.position, userId: user.id, at: now }] };
      await db.collection("spatialMarkers").insertOne(marker);
      return NextResponse.json({ id: String(marker._id) }, { status: 201 });
    }
    const id = typeof b.id === "string" ? parseObjectId(b.id) : null;
    if (!id || !Number.isInteger(b.version) || (b.action === "move" && !vector(b.position))) return NextResponse.json({ error: "Invalid marker update" }, { status: 400 });
    const set = b.action === "move" ? { position: b.position, reviewStatus: "pending" } : b.action === "delete" ? { deletedAt: now } : { reviewStatus: b.action === "confirm" ? "confirmed" : "rejected" };
    const result = await db.collection("spatialMarkers").updateOne({ _id: id, inspectionId: inspection._id, version: b.version, deletedAt: { $exists: false } }, { $set: set, $inc: { version: 1 }, $push: { reviewHistory: { action: b.action, ...(b.action === "move" ? { position: b.position } : {}), userId: user.id, at: now } } } as never);
    if (!result.modifiedCount) return NextResponse.json({ error: "Marker changed; reload and retry" }, { status: 409 });
    return NextResponse.json({ saved: true });
  } catch (e) { return errorResponse(e, "spatial.marker"); }
}
