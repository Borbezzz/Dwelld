import {readJsonBody} from "@/lib/server/request-body";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { requireUser, requireOwnedInspection } from "@/lib/server/access";
import { getDb, parseObjectId } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/api-error";
import { vector } from "@/lib/server/spatial";
import { readMedia } from "@/lib/server/media";
import { describeAtPoint } from "@/lib/server/damage";
import { projectPoint } from "@/lib/server/projection";
import type { SpatialManifest } from "@/lib/spatial/types";
import { after } from "next/server";
import { writeMedia } from "@/lib/server/media";
import { placeVideoPoint, type ScanFrame } from "@/lib/server/video-mark";
import { isFurniture } from "@/lib/spatial/furniture";
import { sealLater } from "@/lib/server/ledger";
import { logAIFailure } from "@/lib/server/analysis-failure";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  try {
    const user = await requireUser(request), { inspectionId } = await params;
    const inspection = await requireOwnedInspection(inspectionId, user.id), db = await getDb();
    const b = await readJsonBody(request, 1536 * 1024);
    const capture = await db.collection("spatialCaptures").findOne({ inspectionId: inspection._id });
    if (!capture) return NextResponse.json({ error: "Import a real spatial capture first" }, { status: 409 });
    if (!["add", "addFromVideo", "move", "delete", "confirm", "reject"].includes(b.action)) return NextResponse.json({ error: "Invalid marker action" }, { status: 400 });
    const now = new Date();
    if (b.action === "addFromVideo") {
      // A click on the recorded walkthrough: place it in 3D from the scan's camera pose, keep the exact
      // video frame as evidence, and let Gemini describe what is at that spot.
      const p = b.point, v = b.video, note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
      const ok = (n: unknown, lo = 0, hi = 1) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
      if (!p || !ok(p.x) || !ok(p.y) || !ok(b.scanTime, 0, 86400) || !v || !ok(v.width, 16, 8192) || !ok(v.height, 16, 8192)) return NextResponse.json({ error: "Invalid video mark" }, { status: 400 });
      const manifest = capture.manifest as SpatialManifest;
      const placed = placeVideoPoint(manifest.frames as unknown as ScanFrame[], manifest.elements, b.scanTime, { x: p.x, y: p.y }, { width: v.width, height: v.height });
      if ("error" in placed) return NextResponse.json({ error: placed.error }, { status: 422 });
      let evidence: Buffer | null = null;
      if (typeof b.snapshot === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.snapshot) && b.snapshot.length < 1_400_000) evidence = Buffer.from(b.snapshot.split(",")[1], "base64");
      // Without a snapshot, fall back to the saved scan photo at that pose, in its own coordinates.
      const frameRef = manifest.assets.find(a => a.name === placed.frame.image && a.kind === "image")?.mediaRef;
      const image = evidence ?? (frameRef ? await readMedia(frameRef, 16 * 1024 * 1024) : null);
      const at = evidence ? { x: p.x, y: p.y } : placed.sensor;
      const seen = image ? await describeAtPoint(image, at).catch(e => { logAIFailure('mark.video', e); return null; }) : null;
      if (!seen && !note) return NextResponse.json({ error: "Couldn't describe that spot automatically. Add a short note and save again." }, { status: 422 });
      const ref = evidence ? await writeMedia(evidence, `video-mark-${Date.now()}.jpg`, "image/jpeg", { ownerId: user.id, inspectionId: String(inspection._id), kind: "manual-mark" }) : frameRef;
      const element = placed.element, furniture = isFurniture(element);
      const label = seen?.label || note.slice(0, 80);
      const finding = { _id: new ObjectId(), ownerId: user.id, inspectionId: inspection._id, roomId: inspection.roomId, kind: "damage", source: "manual", label, damageType: seen?.type || "other", description: [seen?.description, note && `Your note: ${note}`].filter(Boolean).join(" "), evidenceFrameUrl: ref, point: at, boundingBox: seen?.boundingBox ?? null, timestampSeconds: b.scanTime, worldPosition: placed.position, ...(furniture ? { spatialElementId: element.id } : {}), reviewStatus: "confirmed", detectionSource: "manual-video", createdAt: now };
      await db.collection("findings").insertOne(finding);
      const marker = { _id: new ObjectId(), findingId: String(finding._id), inspectionId: inspection._id, ownerId: user.id, sessionId: manifest.sessionId, position: placed.position, label, elementId: furniture ? element.id : null, reviewStatus: "confirmed", version: 1, createdAt: now, reviewHistory: [{ action: "add", source: "video", position: placed.position, userId: user.id, at: now }] };
      await db.collection("spatialMarkers").insertOne(marker);
      after(() => sealLater(inspection._id));
      return NextResponse.json({ id: String(marker._id), findingId: String(finding._id), position: placed.position, elementId: marker.elementId, label, poseGapSeconds: placed.poseGapSeconds }, { status: 201 });
    }
    if (b.action === "add") {
      const note = typeof b.label === "string" ? b.label.trim() : "";
      if (!vector(b.position) || note.length > 500 || (b.elementId != null && !capture.manifest.elements.some((e: { id: string }) => e.id === b.elementId))) return NextResponse.json({ error: "Invalid marker" }, { status: 400 });
      let findingId = null;
      let initialReviewStatus = "pending";
      // No finding chosen: find the photo that saw this 3D point best and let Gemini describe it there.
      if (b.findingId == null) {
        const manifest = capture.manifest as SpatialManifest;
        const view = manifest.frames.map(frame => ({ frame, at: projectPoint(b.position as [number, number, number], frame), ref: manifest.assets.find(a => a.name === frame.image && a.kind === "image")?.mediaRef }))
          .filter(v => v.at && v.ref && v.at.x > .05 && v.at.x < .95 && v.at.y > .05 && v.at.y < .95)
          .sort((p, q) => Math.hypot(p.at!.x - .5, p.at!.y - .5) - Math.hypot(q.at!.x - .5, q.at!.y - .5))[0];
        const seen = view ? await readMedia(view.ref!, 16 * 1024 * 1024).then(image => describeAtPoint(image, view.at!)).catch(() => null) : null;
        if (!seen && !note) return NextResponse.json({ error: view ? "Couldn't describe that spot automatically. Add a short note and save again." : "No photo shows that spot. Add a short note and save again." }, { status: 422 });
        if (seen && view) {
          const finding = { _id: new ObjectId(), ownerId: user.id, inspectionId: inspection._id, roomId: inspection.roomId, kind: "damage", label: seen.label, damageType: seen.type, description: [seen.description, note && `Your note: ${note}`].filter(Boolean).join(" "), evidenceFrameUrl: view.ref, point: view.at, boundingBox: seen.boundingBox, timestampSeconds: view.frame.timestamp, spatialElementId: b.elementId || null, source: "manual", aiDescribed: true, reviewStatus: "confirmed", reviewHistory: [{ from: "pending", to: "confirmed", at: now, by: user.id }], createdAt: now };
          await db.collection("findings").insertOne(finding);
          findingId = finding._id; initialReviewStatus = "confirmed"; b.label = seen.label;
        }
      }
      if (b.findingId != null && !findingId) {
        findingId = typeof b.findingId === "string" ? parseObjectId(b.findingId) : null;
        const linked = findingId && await db.collection("findings").findOne({ _id: findingId, inspectionId: inspection._id });
        if (!linked) return NextResponse.json({ error: "Finding does not belong to this inspection" }, { status: 400 });
        initialReviewStatus = ["pending", "confirmed", "rejected"].includes(linked.reviewStatus) ? linked.reviewStatus : "pending";
      }
      const marker = { findingId: findingId ? String(findingId) : null, _id: new ObjectId(), inspectionId: inspection._id, ownerId: user.id, sessionId: capture.manifest.sessionId, position: b.position, label: String(b.label || note).trim(), elementId: b.elementId || null, reviewStatus: initialReviewStatus, version: 1, createdAt: now, reviewHistory: [{ action: "add", position: b.position, userId: user.id, at: now }] };
      await db.collection("spatialMarkers").insertOne(marker);
      return NextResponse.json({ id: String(marker._id) }, { status: 201 });
    }
    const id = typeof b.id === "string" ? parseObjectId(b.id) : null;
    if (!id || !Number.isInteger(b.version) || (b.action === "move" && !vector(b.position))) return NextResponse.json({ error: "Invalid marker update" }, { status: 400 });
    const marker = await db.collection("spatialMarkers").findOne({ _id: id, inspectionId: inspection._id, version: b.version, deletedAt: { $exists: false } });
    if (!marker) return NextResponse.json({ error: "Marker changed; reload and retry" }, { status: 409 });
    const set = b.action === "move" ? { position: b.position, reviewStatus: "pending" } : b.action === "delete" ? { deletedAt: now } : { reviewStatus: b.action === "confirm" ? "confirmed" : "rejected" };
    const result = await db.collection("spatialMarkers").updateOne({ _id: id, inspectionId: inspection._id, version: b.version, deletedAt: { $exists: false } }, { $set: set, $inc: { version: 1 }, $push: { reviewHistory: { action: b.action, ...(b.action === "move" ? { position: b.position } : {}), userId: user.id, at: now } } } as never);
    if (!result.modifiedCount) return NextResponse.json({ error: "Marker changed; reload and retry" }, { status: 409 });
    if ((b.action === "confirm" || b.action === "reject" || b.action === "move") && marker.findingId) {
      const findingId = parseObjectId(String(marker.findingId));
      const reviewStatus = b.action === "confirm" ? "confirmed" : b.action === "move" ? "pending" : "rejected";
      if (findingId) await db.collection("findings").updateOne({ _id: findingId, inspectionId: inspection._id }, { $set: { reviewStatus, reviewedAt: now, autoApproved: false }, $push: { reviewHistory: { from: "marker", to: reviewStatus, at: now, by: user.id } } } as never);
    }
    return NextResponse.json({ saved: true });
  } catch (e) { return errorResponse(e, "spatial.marker"); }
}
