import { randomUUID } from "node:crypto";
import type { SessionDoc } from "./live-sessions";
import { liveCollections, recordLiveAnalysis } from "./live-sessions";
import { analyzeLiveFrame } from "./live-analysis";
import { detectImageObjects } from "./yolo";
import type { LiveFinding } from "../live/types";

export type NativePose = { transform: number[]; intrinsics: number[]; width: number; height: number };
export type NativeElement = { id: string; category: string; dimensions: [number, number, number]; transform: number[] };
/** COCO classes treated as furniture during a live scan (electronics are ignored). */
const FURNITURE_CLASSES = new Set([56, 57, 59, 60]);

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
export function validPose(value: unknown): NativePose | undefined {
  const p = value as NativePose | undefined;
  if (!p || !Array.isArray(p.transform) || p.transform.length !== 16 || !p.transform.every(finite) || !Array.isArray(p.intrinsics) || p.intrinsics.length !== 9 || !p.intrinsics.every(finite) || !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 16 || p.height < 16 || p.width > 8000 || p.height > 8000) return undefined;
  return { transform: p.transform, intrinsics: p.intrinsics, width: p.width, height: p.height };
}
export function validElements(value: unknown): NativeElement[] | undefined {
  if (!Array.isArray(value) || value.length > 80) return undefined;
  const out: NativeElement[] = [];
  for (const e of value as NativeElement[]) {
    if (!e || typeof e.id !== "string" || e.id.length > 64 || typeof e.category !== "string" || e.category.length > 60 || !Array.isArray(e.dimensions) || e.dimensions.length !== 3 || !e.dimensions.every(finite) || !Array.isArray(e.transform) || e.transform.length !== 16 || !e.transform.every(finite)) return undefined;
    out.push({ id: e.id, category: e.category, dimensions: e.dimensions, transform: e.transform });
  }
  return out;
}
export function validSplat(value: unknown) { return typeof value === "string" && value.length <= 90_000 && /^[A-Za-z0-9+/=]*$/.test(value) ? value : undefined; }

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
