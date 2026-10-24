import {inspectCracks, CRACK_MODEL} from './crack-detector';
import { readMedia, writeMedia, deleteMedia, parseMediaId } from "./media";
import { videoSampleTimes } from "../video-sampling";
import { createHash } from "node:crypto";
import { openVideoFrames } from "./video-frames";
import { inspectVideoDamageBatch, inspectObjectDamage, inspectSurfaceDamage, inspectUnsupportedFurniture, validBox, type Box, type DamageObservation } from "./damage";
export type { Box } from "./damage";

export type ClientDetection = { objectId: string; label: string; boundingBox: Box; classId?: number; confidence?: number };
export type ClientFrameDetections = { timestampSeconds: number; detections: ClientDetection[] };
export type AnalyzedFinding = {
  kind: "object" | "damage"; label: string; description: string; timestampSeconds: number;
  boundingBox: Box | null; originalVideoBoundingBox: Box | null;
  localizationStatus: "localized" | "uncertain"; objectLabel: string | null;
  evidenceFrameUrl: string | null; reviewStatus: "unreviewed";
  detectionSource: "yolo" | "gemini" | "crack-model";
  detectionId: string; parentDetectionId: string | null; classId?: number; confidence?: number;
};

// COCO furniture/fixture classes supported by the browser YOLO model.
const classes: Record<number, string> = { 56: "chair", 57: "couch", 58: "potted plant", 59: "bed", 60: "dining table", 61: "toilet", 62: "tv", 63: "laptop", 68: "microwave", 69: "oven", 70: "toaster", 71: "sink", 72: "refrigerator", 74: "clock", 75: "vase" };
const labels = new Set(Object.values(classes));
export function validateClientFrames(value: unknown, durationSeconds = Infinity): ClientFrameDetections[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 121) throw new Error("Provide between one and 121 analyzed video frames");
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
export async function analyzeDetectedImage(image: Buffer, detections: ClientDetection[], timestampSeconds = 0, frameKey = "image", warnings: string[] = [], deadlineMs = Date.now() + 240_000): Promise<AnalyzedFinding[]> {
  async function runScope<T>(label: string, work: () => Promise<T>): Promise<T | null> {
    if (deadlineMs - Date.now() < 45_000) {
      warnings.push(`Frame ${timestampSeconds}s: ${label} was not analyzed because the analysis time budget was reached.`);
      return null;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await work(); }
      catch (error) {
        // Inspect only for classification. Never expose provider responses or credentials.
        const candidate = error as { status?: number; code?: number | string; message?: string } | null;
        const status = candidate?.status ?? candidate?.code;
        const transient = [429, 503, 504, "429", "503", "504"].includes(status ?? "")
          || /DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|timeout|timed out|\b(?:429|503|504)\b/i.test(candidate?.message || "");
        if (attempt === 0 && transient && deadlineMs - Date.now() > 90_000) continue;
        warnings.push(`Frame ${timestampSeconds}s: ${label} could not be analyzed${transient ? " because the AI service timed out or was temporarily unavailable" : " because the AI response or analysis was unsuccessful"}. Damage assessment is incomplete.`);
        return null;
      }
    }
    return null;
  }
  const validated = validateClientFrames([{ timestampSeconds, detections }])[0];
  if (image.length > 30 * 1024 * 1024) throw new Error("Evidence frame exceeds 30 MB");
  const findings: AnalyzedFinding[] = [];
  const base = { timestampSeconds, originalVideoBoundingBox: null, evidenceFrameUrl: null, reviewStatus: "unreviewed" as const };
  function damageFinding(observation: DamageObservation, parentDetectionId: string | null, objectLabel: string | null, index: number): AnalyzedFinding {
    return { ...base, detectionSource: "gemini", kind: "damage", label: observation.type, description: observation.description, boundingBox: observation.boundingBox,
      localizationStatus: observation.boundingBox ? "localized" : "uncertain", objectLabel, parentDetectionId,
      detectionId: `${frameKey}_damage_${parentDetectionId || "surface"}_${index}` };
  }
  // Bounded parallel batches keep provider pressure predictable, while preserving input order.
  for (let offset = 0; offset < validated.detections.length; offset += 4) {
    const batch = validated.detections.slice(offset, offset + 4);
    const results = await Promise.all(batch.map(async (d) => {
      const id = `${frameKey}_${d.objectId}`;
      const object: AnalyzedFinding = { ...base, detectionSource: "yolo", kind: "object", label: d.label, description: `${d.label} detected by the browser object model.`, boundingBox: d.boundingBox,
        localizationStatus: "localized", objectLabel: null, detectionId: id, parentDetectionId: null, classId: d.classId, confidence: d.confidence };
      const damage = await runScope(`damage on ${d.label}`, () => inspectObjectDamage(image, d.label, d.boundingBox));
      return [object, ...(damage || []).map((item, index) => damageFinding(item, id, d.label, index))];
    }));
    findings.push(...results.flat());
  }
  const supplemental = await runScope("supplementary furniture detection", () => inspectUnsupportedFurniture(image, validated.detections.map((d) => d.boundingBox))) || [];
  const supplementalFindings = await Promise.all(supplemental.map(async (d, index) => {
    const id = `${frameKey}_gemini_${index}`;
    const object: AnalyzedFinding = { ...base, detectionSource: "gemini", kind: "object", label: d.label,
      description: `${d.description} (Gemini-assisted observation; requires review.)`, boundingBox: d.boundingBox,
      localizationStatus: "localized", objectLabel: null, detectionId: id, parentDetectionId: null };
    const damage = await runScope(`damage on ${d.label}`, () => inspectObjectDamage(image, d.label, d.boundingBox));
    return [object, ...(damage || []).map((item, damageIndex) => damageFinding(item, id, d.label, damageIndex))];
  }));
  findings.push(...supplementalFindings.flat());
  const surfaces = await runScope("room surface damage", () => inspectSurfaceDamage(image));
  findings.push(...(surfaces || []).map((item, index) => damageFinding(item, null, null, index)));
  const cracks=await runScope("specialised crack detection",()=>inspectCracks(image));
  for(const [index,crack] of (cracks||[]).entries()) findings.push({...base,kind:'damage',label:'Potential crack',description:`Pretrained crack model candidate (${CRACK_MODEL}); may confuse joints, shadows and texture with cracks. Requires human review.`,boundingBox:crack.boundingBox,localizationStatus:'localized',objectLabel:null,parentDetectionId:null,detectionId:`${frameKey}_crack_${index}`,detectionSource:'crack-model',confidence:crack.confidence});
  return findings;
}

export async function analyzeVideo(videoUrl: string, mimeType: string, clientFrames: unknown): Promise<{ durationSeconds: number; findings: AnalyzedFinding[]; warnings: string[]; incomplete: boolean }> {
  const deadlineMs = Date.now() + 240_000;
  const warnings: string[] = [];
  if (!process.env.GEMINI_API_KEY) throw new Error("Gemini damage analysis requires GEMINI_API_KEY");
  const requested = validateClientFrames(clientFrames);
  const normalizedMimeType = mimeType.split(";")[0].trim().toLowerCase();
  if (!new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"]).has(normalizedMimeType)) throw new Error("Unsupported video format");
  if (!parseMediaId(videoUrl)) throw new Error("Video must refer to a MongoDB media upload");
  const video = await readMedia(videoUrl, 100 * 1024 * 1024);
  const frames = await openVideoFrames(video);
  const storedFrames: string[] = [];
  try {
    const client = validateClientFrames(requested, frames.durationSeconds);
    const selected = videoSampleTimes(Math.min(frames.durationSeconds, 120)).map(timestampSeconds => ({ timestampSeconds, detections: client.find(f => Math.abs(f.timestampSeconds - timestampSeconds) < .01)?.detections || [] }));
    const findings: AnalyzedFinding[] = [];
    const seenFrames = new Set<string>();
    const seenObjects = new Map<string, string>();
    let cursor = 0;
    async function worker() {
      while (cursor < selected.length) {
        const batch = selected.slice(cursor, cursor += 6);
        if (Date.now() > deadlineMs - 65_000) { warnings.push(`${batch.length} evidence frames starting at ${batch[0].timestampSeconds}s were not analysed because the time budget ran out.`); continue; }
        try {
          const extracted: { image: Buffer; timestampSeconds: number; detections: ClientDetection[] }[] = [];
          for (const frame of batch) {
            const image = await frames.extract(frame.timestampSeconds);
            const hash = createHash("sha256").update(image).digest("hex");
            if (seenFrames.has(hash)) continue;
            seenFrames.add(hash); extracted.push({ ...frame, image });
          }
          if (!extracted.length) continue;
          const [damage, supplemental] = await Promise.all([
            inspectVideoDamageBatch(extracted),
            inspectUnsupportedFurniture(extracted[0].image, extracted[0].detections.map(d => d.boundingBox)).catch(() => { warnings.push(`Supplementary furniture check at ${extracted[0].timestampSeconds}s could not finish.`); return []; }),
          ]);
          for (const frame of extracted) {
            const key = `video_${Math.round(frame.timestampSeconds * 1000)}`;
            const stored = await writeMedia(frame.image, `evidence/${crypto.randomUUID()}.png`, "image/png");
            storedFrames.push(stored);
            const base = { timestampSeconds: frame.timestampSeconds, evidenceFrameUrl: stored, originalVideoBoundingBox: null, reviewStatus: 'unreviewed' as const, localizationStatus: 'localized' as const, objectLabel: null, parentDetectionId: null };
            frame.detections.filter(d => { if(seenObjects.has(d.objectId)) return false; seenObjects.set(d.objectId, `${key}_${d.objectId}`); return true; }).forEach(d => findings.push({ ...base, kind: 'object', label: d.label, description: `${d.label} detected by the browser object model.`, boundingBox: d.boundingBox, detectionId: `${key}_${d.objectId}`, detectionSource: 'yolo', classId: d.classId, confidence: d.confidence }));
            if (frame === extracted[0]) supplemental.forEach((d, i) => findings.push({ ...base, kind: 'object', label: d.label, description: `${d.description} (Gemini-assisted observation; requires review.)`, boundingBox: d.boundingBox, detectionSource: 'gemini', detectionId: `${key}_supplemental_${i}` }));
            (damage.get(frame.timestampSeconds) || []).forEach((d, i) => {
              const box = d.boundingBox;
              const owner = box ? frame.detections.filter(o => box.x + box.width / 2 >= o.boundingBox.x && box.x + box.width / 2 <= o.boundingBox.x + o.boundingBox.width && box.y + box.height / 2 >= o.boundingBox.y && box.y + box.height / 2 <= o.boundingBox.y + o.boundingBox.height).sort((a,b) => a.boundingBox.width*a.boundingBox.height-b.boundingBox.width*b.boundingBox.height)[0] : null;
              findings.push({ ...base, kind: 'damage', label: d.type, description: d.description, boundingBox: box, localizationStatus: box ? 'localized' : 'uncertain', detectionSource: 'gemini', detectionId: `${key}_damage_${i}`, parentDetectionId: owner ? seenObjects.get(owner.objectId) || null : null, objectLabel: owner?.label || null });
            });
            try {
              const cracks = await inspectCracks(frame.image);
              cracks.forEach((d, i) => findings.push({ ...base, kind: 'damage', label: 'Potential crack', description: 'Specialist crack candidate. Review against the source photo.', boundingBox: d.boundingBox, detectionSource: 'crack-model', detectionId: `${key}_crack_${i}`, confidence: d.confidence }));
            } catch { warnings.push(`Specialist crack check at ${frame.timestampSeconds}s could not finish.`); }
          }
        } catch { warnings.push(`Damage analysis for frames ${batch[0].timestampSeconds}s–${batch[batch.length - 1].timestampSeconds}s failed. These views remain unassessed.`); }
      }
    }
    await Promise.all([worker(), worker()]);
    findings.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    return { durationSeconds: frames.durationSeconds, findings, warnings, incomplete: warnings.length > 0 };
  } catch (error) {
    await Promise.all(storedFrames.map((url) => deleteMedia(url).catch(() => undefined)));
    throw error;
  } finally { await frames.close(); }
}

export const validateDetectionFrames = validateClientFrames;
