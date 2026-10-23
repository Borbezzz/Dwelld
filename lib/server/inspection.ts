import { get as getBlob, put, del } from "@vercel/blob";
import { createHash } from "node:crypto";
import { openVideoFrames } from "./video-frames";
import { inspectObjectDamage, inspectSurfaceDamage, validBox, type Box, type DamageObservation } from "./damage";
export type { Box } from "./damage";

export type ClientDetection = { objectId: string; label: string; boundingBox: Box; classId?: number; confidence?: number };
export type ClientFrameDetections = { timestampSeconds: number; detections: ClientDetection[] };
export type AnalyzedFinding = {
  kind: "object" | "damage"; label: string; description: string; timestampSeconds: number;
  boundingBox: Box | null; originalVideoBoundingBox: Box | null;
  localizationStatus: "localized" | "uncertain"; objectLabel: string | null;
  evidenceFrameUrl: string | null; reviewStatus: "unreviewed";
  detectionId: string; parentDetectionId: string | null; classId?: number; confidence?: number;
};

// COCO furniture/fixture classes supported by the browser YOLO model.
const classes: Record<number, string> = { 56: "chair", 57: "couch", 58: "potted plant", 59: "bed", 60: "dining table", 61: "toilet", 62: "tv", 63: "laptop", 68: "microwave", 69: "oven", 70: "toaster", 71: "sink", 72: "refrigerator", 74: "clock", 75: "vase" };
const labels = new Set(Object.values(classes));
export function validateClientFrames(value: unknown, durationSeconds = Infinity): ClientFrameDetections[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error("Provide between one and three analyzed video frames");
  const times = new Set<number>();
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid analyzed frame");
    const f = raw as Record<string, unknown>;
    if (typeof f.timestampSeconds !== "number" || !Number.isFinite(f.timestampSeconds) || f.timestampSeconds < 0 || f.timestampSeconds >= durationSeconds || times.has(f.timestampSeconds)) throw new Error("Invalid or duplicate frame timestamp");
    times.add(f.timestampSeconds);
    if (!Array.isArray(f.detections) || f.detections.length > 20) throw new Error("A frame may contain at most 20 detections");
    const ids = new Set<string>();
    const detections = f.detections.map((entry: unknown): ClientDetection => {
      if (!entry || typeof entry !== "object") throw new Error("Invalid object detection");
      const d = entry as Record<string, unknown>;
      const boundingBox = validBox(d.boundingBox);
      if (typeof d.objectId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(d.objectId) || ids.has(d.objectId) || typeof d.label !== "string" || !labels.has(d.label) || !boundingBox) throw new Error("Invalid object detection coordinates, label or ID");
      ids.add(d.objectId);
      if (d.classId !== undefined && (typeof d.classId !== "number" || !Number.isInteger(d.classId) || classes[d.classId] !== d.label)) throw new Error("Invalid object class");
      if (d.confidence !== undefined && (typeof d.confidence !== "number" || !Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1)) throw new Error("Invalid detector confidence");
      return { objectId: d.objectId, label: d.label, boundingBox, ...(d.classId === undefined ? {} : { classId: d.classId as number }), ...(d.confidence === undefined ? {} : { confidence: d.confidence as number }) };
    });
    return { timestampSeconds: f.timestampSeconds, detections };
  });
}

/** Single-image entry point. Detections are actual browser YOLO output, never fabricated. */
export async function analyzeDetectedImage(image: Buffer, detections: ClientDetection[], timestampSeconds = 0, frameKey = "image"): Promise<AnalyzedFinding[]> {
  const validated = validateClientFrames([{ timestampSeconds, detections }])[0];
  if (image.length > 30 * 1024 * 1024) throw new Error("Evidence frame exceeds 30 MB");
  const findings: AnalyzedFinding[] = [];
  const base = { timestampSeconds, originalVideoBoundingBox: null, evidenceFrameUrl: null, reviewStatus: "unreviewed" as const };
  function damageFinding(observation: DamageObservation, parentDetectionId: string | null, objectLabel: string | null, index: number): AnalyzedFinding {
    return { ...base, kind: "damage", label: observation.type, description: observation.description, boundingBox: observation.boundingBox,
      localizationStatus: observation.boundingBox ? "localized" : "uncertain", objectLabel, parentDetectionId,
      detectionId: `${frameKey}_damage_${parentDetectionId || "surface"}_${index}` };
  }
  // Bounded parallel batches keep provider pressure predictable, while preserving input order.
  for (let offset = 0; offset < validated.detections.length; offset += 4) {
    const batch = validated.detections.slice(offset, offset + 4);
    const results = await Promise.all(batch.map(async (d) => {
      const id = `${frameKey}_${d.objectId}`;
      const object: AnalyzedFinding = { ...base, kind: "object", label: d.label, description: `${d.label} detected by the browser object model.`, boundingBox: d.boundingBox,
        localizationStatus: "localized", objectLabel: null, detectionId: id, parentDetectionId: null, classId: d.classId, confidence: d.confidence };
      const damage = await inspectObjectDamage(image, d.label, d.boundingBox);
      return [object, ...damage.map((item, index) => damageFinding(item, id, d.label, index))];
    }));
    findings.push(...results.flat());
  }
  const surfaces = await inspectSurfaceDamage(image);
  findings.push(...surfaces.map((item, index) => damageFinding(item, null, null, index)));
  return findings;
}

export async function analyzeVideo(videoUrl: string, mimeType: string, clientFrames: unknown): Promise<{ durationSeconds: number; findings: AnalyzedFinding[] }> {
  if (!process.env.GEMINI_API_KEY) throw new Error("Gemini damage analysis requires GEMINI_API_KEY");
  const requested = validateClientFrames(clientFrames);
  const normalizedMimeType = mimeType.split(";")[0].trim().toLowerCase();
  if (!new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"]).has(normalizedMimeType)) throw new Error("Unsupported video format");
  let pathname: string;
  try {
    const url = new URL(videoUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".private.blob.vercel-storage.com")) throw new Error();
    pathname = decodeURIComponent(url.pathname.slice(1));
  } catch { throw new Error("Video URL must refer to a private Vercel Blob upload"); }
  const blob = await getBlob(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new Error("Could not retrieve the uploaded inspection video");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = blob.stream.getReader();
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 100 * 1024 * 1024) throw new Error("Video exceeds the 100 MB analysis limit");
      chunks.push(chunk);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const frames = await openVideoFrames(Buffer.concat(chunks));
  const storedFrames: string[] = [];
  try {
    const selected = validateClientFrames(requested, frames.durationSeconds);
    const findings: AnalyzedFinding[] = [];
    const seenFrames = new Set<string>();
    for (const frame of selected) {
      const image = await frames.extract(frame.timestampSeconds);
      const imageHash = createHash("sha256").update(image).digest("hex");
      if (seenFrames.has(imageHash)) continue;
      seenFrames.add(imageHash);
      const key = createHash("sha256").update(`${pathname}:${frame.timestampSeconds}`).digest("hex").slice(0, 16);
      const observations = await analyzeDetectedImage(image, frame.detections, frame.timestampSeconds, key);
      if (observations.length === 0) continue;
      const stored = await put(`evidence/${crypto.randomUUID()}.png`, image, { access: "private", contentType: "image/png" });
      storedFrames.push(stored.url);
      findings.push(...observations.map((item) => ({ ...item, evidenceFrameUrl: stored.url })));
    }
    return { durationSeconds: frames.durationSeconds, findings };
  } catch (error) {
    await Promise.all(storedFrames.map((url) => del(url).catch(() => undefined)));
    throw error;
  } finally { await frames.close(); }
}

export const validateDetectionFrames = validateClientFrames;
