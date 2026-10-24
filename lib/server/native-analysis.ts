import { ObjectId, type Document } from "mongodb";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { readMedia } from "./media";
import { indexFindings } from "./search";
import { analyzeEvidenceFrame, elementInView, type FrameFinding, type FramePose, type RoomElement } from "./frame-analysis";
import { insideElement } from "../spatial/identity";
import { furnitureNames, isFurniture } from "../spatial/furniture";
import type { SpatialManifest, SpatialElement } from "../spatial/types";

/** Live: analyse one uploaded evidence photo and publish its findings to the laptop as they are verified. */
export async function analyzeLiveEvidenceFrame(sessionId: ObjectId, name: string) {
  const db = await getDb(), frames = db.collection("liveFrames");
  const frame = await frames.findOneAndUpdate({ sessionId, name, status: "queued" }, { $set: { status: "analyzing", startedAt: new Date() } }, { returnDocument: "after" });
  if (!frame) return;
  try {
    const session = await db.collection("liveSessions").findOne({ _id: sessionId });
    const elements = (session?.nativeLive?.elements || []) as RoomElement[];
    const done = await frames.countDocuments({ sessionId, status: "done" });
    const image = await readMedia(frame.ref, 12 * 1024 * 1024);
    const result = await analyzeEvidenceFrame(image, frame.pose as FramePose, elements, { walls: done % 2 === 0 });
    await db.collection("liveEvidence").updateOne({ sessionId, observationId: `frame-${name}` }, { $setOnInsert: { sessionId, observationId: `frame-${name}`, ref: frame.ref, createdAt: new Date() } }, { upsert: true });
    if (result.findings.length) await db.collection("liveFindings").insertMany(result.findings.map(f => ({ ...f, id: randomUUID(), sessionId, kind: "damage", source: "ai", frameName: name, evidenceFrameRef: frame.ref, timestampSeconds: frame.timestampSeconds, pose: frame.pose, ...(f.worldPosition ? {} : { worldPosition: undefined }), createdAt: new Date(), reviewHistory: f.autoApproved ? [{ from: "pending", to: "confirmed", at: new Date(), by: "auto-verifier", confidence: f.verification?.confidence }] : [] })));
    await frames.updateOne({ _id: frame._id }, { $set: { status: "done", views: result.views, findings: result.findings.length, dropped: result.dropped, finishedAt: new Date() } });
  } catch (error) {
    await frames.updateOne({ _id: frame._id }, { $set: { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "failed" } });
  }
}

function ownerFor(f: { elementId?: string | null; worldPosition?: number[] | null }, elements: SpatialElement[]) {
  if (f.elementId && elements.some(e => e.id === f.elementId)) return f.elementId;
  if (!f.worldPosition) return null;
  const pos = f.worldPosition as [number, number, number];
  return elements.filter(e => insideElement(pos, e, .12)).sort((a, b) => a.dimensions.reduce((x, y) => x * Math.max(y, .02), 1) - b.dimensions.reduce((x, y) => x * Math.max(y, .02), 1))[0]?.id ?? null;
}

/**
 * Saved LiDAR scan. Every evidence photo is analysed against the final measured room: photos already
 * done during the scan reuse their verified findings, the rest are analysed now. Each piece of
 * furniture gets its best photo as an "object" finding so the room page can show where it was seen.
 */
export async function analyzeNativeInspection(inspection: Document, manifest: SpatialManifest, sessionId: ObjectId | null) {
  const db = await getDb(), warnings: string[] = ["Photos and LiDAR geometry do not cover every surface. Damage checks cover tables, cabinets, chairs, sofas, beds, doors and walls that appear in the photos. Anything out of frame was not assessed."];
  const deadline = Date.now() + 240_000;
  try {
    await db.collection("inspections").updateOne({ _id: inspection._id }, { $set: { status: "processing" } });
    const elements = manifest.elements, base = { ownerId: inspection.ownerId, inspectionId: inspection._id, roomId: inspection.roomId };
    const imageRef = (name: string) => manifest.assets.find(a => a.name === name && a.kind === "image")?.mediaRef;
    const liveFrames = sessionId ? await db.collection("liveFrames").find({ sessionId, status: "done" }).toArray() : [];
    const liveFindings = sessionId ? await db.collection("liveFindings").find({ sessionId, source: "ai", frameName: { $exists: true } }).toArray() : [];
    const collected: (FrameFinding & { ref: string; timestampSeconds: number; liveId?: string })[] = [];
    // Reuse what the scan already found.
    for (const f of liveFindings) if (f.reviewStatus !== "rejected") collected.push({ ...(f as unknown as FrameFinding), ref: f.evidenceFrameRef, timestampSeconds: f.timestampSeconds, liveId: f.id, reviewStatus: f.reviewStatus });
    // Analyse the rest, three photos at a time, within the time budget.
    const todo = manifest.frames.filter(fr => !liveFrames.some(l => l.ref === imageRef(fr.image)) && imageRef(fr.image));
    let analysed = liveFrames.length, skipped = 0;
    for (let i = 0; i < todo.length; i += 3) {
      if (Date.now() > deadline - 60_000) { skipped = todo.length - i; break; }
      await Promise.all(todo.slice(i, i + 3).map(async (fr, j) => {
        try {
          const ref = imageRef(fr.image)!, image = await readMedia(ref, 12 * 1024 * 1024);
          const result = await analyzeEvidenceFrame(image, fr, elements as RoomElement[], { walls: (i + j) % 2 === 0 });
          result.findings.forEach(f => collected.push({ ...f, ref, timestampSeconds: fr.timestamp })); analysed++;
        } catch { warnings.push(`Photo at ${fr.timestamp.toFixed(1)}s could not be analysed.`); }
      }));
    }
    if (skipped) warnings.push(`${skipped} photos were not analysed because the time budget ran out.`);
    // Damage findings and their 3D markers.
    for (const f of collected) {
      const id = new ObjectId(), elementId = ownerFor(f, elements);
      await db.collection("findings").insertOne({ ...base, _id: id, kind: "damage", label: f.label, description: f.description, damageType: f.damageType, evidenceFrameUrl: f.ref, boundingBox: f.boundingBox, timestampSeconds: f.timestampSeconds, source: "ai", detectionSource: f.detectionSource, spatialElementId: elementId, reviewStatus: f.reviewStatus, autoApproved: !!f.autoApproved, ...(f.confidence != null ? { confidence: f.confidence } : {}), ...(f.verification ? { verification: { ...f.verification, model: process.env.GEMINI_VERIFY_MODEL || process.env.GEMINI_MODEL || "gemini-4-argon", at: new Date() } } : {}), reviewHistory: f.autoApproved ? [{ from: "pending", to: "confirmed", at: new Date(), by: "auto-verifier", confidence: f.verification?.confidence }] : [], ...(f.liveId ? { liveFindingId: f.liveId } : {}), createdAt: new Date() });
      if (f.worldPosition) await db.collection("spatialMarkers").insertOne({ ...base, sessionId: manifest.sessionId, findingId: String(id), position: f.worldPosition, label: f.description || f.label, elementId, reviewStatus: f.reviewStatus, version: 1, source: "photo-projection", createdAt: new Date(), reviewHistory: [{ action: "projected", at: new Date() }] });
    }
    // Where each piece of furniture was seen best.
    const furniture = elements.filter(isFurniture), names = furnitureNames(furniture);
    for (const e of furniture) {
      let best: { box: { x: number; y: number; width: number; height: number }; area: number; ref: string; t: number } | null = null;
      for (const fr of manifest.frames) { const ref = imageRef(fr.image); if (!ref) continue; const v = elementInView(e as RoomElement, fr as FramePose); if (v && (!best || v.area > best.area)) best = { box: v.box, area: v.area, ref, t: fr.timestamp }; }
      if (best) await db.collection("findings").insertOne({ ...base, kind: "object", label: names.get(e.id) || e.category, spatialElementId: e.id, evidenceFrameUrl: best.ref, boundingBox: best.box, timestampSeconds: best.t, source: "ai", detectionSource: "roomplan", reviewStatus: "confirmed", reviewHistory: [], createdAt: new Date() });
    }
    const approved = collected.filter(f => f.autoApproved).length;
    await db.collection("inspections").updateOne({ _id: inspection._id }, { $set: { status: skipped ? "partial" : "completed", analysisWarnings: [...new Set(warnings)], autoReview: { checked: collected.filter(f => f.verification).length, approved }, framesAnalysed: analysed, completedAt: new Date(), durationSeconds: manifest.frames.at(-1)?.timestamp || 0 } });
    await indexFindings(inspection.ownerId, inspection._id).catch(() => {});
  } catch {
    await db.collection("inspections").updateOne({ _id: inspection._id }, { $set: { status: "partial", analysisWarnings: [...warnings, "Analysis did not finish. The capture is preserved."] } });
  }
}
