import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { SessionDoc } from "./live-sessions";
import { liveCollections, recordLiveAnalysis } from "./live-sessions";
import { analyzeLiveFrame } from "./live-analysis";
import { detectImageObjects } from "./yolo";
import type { LiveFinding } from "../live/types";

export { validPose, validElements, validSplat, type NativePose, type NativeElement } from "./native-validate";
import { FURNITURE_CLASSES, type NativePose } from "./native-validate";

/**
 * Damage check on the phone's latest preview while it is still scanning.
 * Furniture found by YOLO is checked by Gemini; with no furniture in view, room surfaces are checked instead.
 * Each finding keeps the camera pose so the laptop can pin it inside the live 3D room.
 */
export async function analyzeNativePreview(session: SessionDoc, preview: string, pose: NativePose | undefined, timestampSeconds: number) {
  const { sessions } = await liveCollections();
  const now = new Date();
  const lock = await sessions.findOneAndUpdate({ _id: session._id, inspectionId: { $exists: false }, status: { $ne: "saved" }, $or: [{ analysisAfter: { $exists: false } }, { analysisAfter: { $lte: now } }] }, { $set: { analysisAfter: new Date(+now + 180_000), analysisInFlight: true } }, { returnDocument: "after" });
  if (!lock) return;
  try {
    const image = Buffer.from(preview.slice(preview.indexOf(",") + 1), "base64");
    const detections = await detectImageObjects(image).catch(() => []);
    const furniture = detections.filter(d => FURNITURE_CLASSES.has(d.classId)).sort((a, b) => b.confidence - a.confidence).slice(0, 2)
      .map((d, i) => ({ objectId: `native-${Date.now()}-${i}`, label: d.label, classId: d.classId, boundingBox: d.boundingBox }));
    const observationId = randomUUID();
    const result = await analyzeLiveFrame(image, { sessionId: String(session._id), observationId, timestampSeconds, objects: furniture, includeSurfaces: !furniture.length });
    const findings: LiveFinding[] = result.findings.map(f => ({ ...f, kind: "damage" as const, boundingBox: f.boundingBox ?? undefined, ...(pose ? { pose } : {}) }));
    if (result.analysisWarnings?.length) await sessions.updateOne({ _id: session._id }, { $addToSet: { analysisWarnings: { $each: result.analysisWarnings } } });
    await recordLiveAnalysis(session, observationId, { evidenceFrameRef: result.evidenceFrameRef, findings });
  } catch (error) { console.error("native live analysis failed", error instanceof Error ? error.message : error); }
  finally { await sessions.updateOne({ _id: session._id }, { $set: { analysisAfter: new Date(Date.now() + 8_000), analysisInFlight: false } }); }
}

/** Furniture the point sits on or in (with a small margin), else the nearest piece within 40 cm. */
function elementAt(position: number[], elements: { id: string; category: string; dimensions: number[]; transform: number[] }[]) {
  let best: { id: string; score: number } | null = null;
  for (const e of elements) {
    if (!/^(bed|sofa|chair|table|storage)$/i.test(e.category.replace(/[^a-z]/gi, ""))) continue;
    const t = e.transform, px = position[0] - t[12], py = position[1] - t[13], pz = position[2] - t[14];
    // Rotation is orthonormal: local = R^T * (p - origin); columns are the element axes.
    const local = [0, 1, 2].map(c => t[c * 4] * px + t[c * 4 + 1] * py + t[c * 4 + 2] * pz);
    const outside = local.map((v, i) => Math.max(0, Math.abs(v) - e.dimensions[i] / 2 - .08));
    const score = Math.hypot(...outside);
    if (score < .4 && (!best || score < best.score)) best = { id: e.id, score };
  }
  return best?.id ?? null;
}

/** Marks made on the phone become confirmed findings with real-world markers in the saved scan. */
export async function importPhoneMarks(session: SessionDoc, inspectionId: ObjectId, manifest: { sessionId: string; elements: { id: string; category: string; dimensions: number[]; transform: number[] }[] }, timestampOffset = 0) {
  const { db } = await liveCollections();
  const marks = await db.collection("liveFindings").find({ sessionId: session._id, source: "manual" }).toArray();
  for (const m of marks) {
    const existing = await db.collection("findings").findOne({ inspectionId, liveFindingId: m.id }, { projection: { _id: 1 } });
    const findingId = existing?._id ?? new ObjectId();
    if (!existing) await db.collection("findings").insertOne({ _id: findingId, ownerId: session.ownerId, inspectionId, roomId: session.roomId, kind: "damage", userNote:m.userNote||"", spatialElementId: m.worldPosition?elementAt(m.worldPosition,manifest.elements):null, label: m.label, description: m.description, evidenceFrameUrl: m.evidenceFrameRef, boundingBox: m.boundingBox ?? null, point: m.point ?? null, timestampSeconds: m.timestampSeconds + timestampOffset, source: "manual", detectionSource: "gemini", reviewStatus: "confirmed", reviewHistory: [{ from: "pending", to: "confirmed", at: new Date(), by: "marked-on-phone" }], liveFindingId: m.id, createdAt: new Date() });
    if (Array.isArray(m.worldPosition) && m.worldPosition.length === 3) await db.collection("spatialMarkers").updateOne({ inspectionId, findingId: String(findingId) }, { $setOnInsert: { inspectionId, ownerId: session.ownerId, sessionId: manifest.sessionId, findingId: String(findingId), position: m.worldPosition, label: m.description || m.label, elementId: elementAt(m.worldPosition, manifest.elements), reviewStatus: "confirmed", version: 1, source: "phone-lidar-crosshair", createdAt: new Date(), reviewHistory: [{ action: "marked-on-phone", at: new Date() }] } }, { upsert: true });
  }
  return marks.length;
}
