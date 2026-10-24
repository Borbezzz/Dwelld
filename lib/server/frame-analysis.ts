import {analysisFailure, logAIFailure} from "./analysis-failure";
import sharp from "sharp";
import { isFurniture } from "../spatial/furniture";
import type {DepthPatch} from "./crack-check";
import { inspectVisibleDamage, scopeForName, type DamageObservation, type Box } from "./damage";
import { verifyFinding, autoApproveThreshold, reviewDecision, type Verdict } from "./verify";

/** Camera pose of one evidence photo, in the scan's world space (ARKit, metres, Y up, column-major). */
export type FramePose = { transform: number[]; intrinsics: number[]; width: number; height: number };
export type RoomElement = { id: string; category: string; dimensions: number[]; transform: number[] };
type Scope = NonNullable<ReturnType<typeof scopeForName>>;
export type FrameFinding = { label: string; description: string; damageType: string; boundingBox: Box | null; elementId: string | null; elementCategory: string; worldPosition: [number, number, number] | null; detectionSource: "gemini" | "crack-model"; verification?: Verdict & { threshold: number }; reviewStatus: "pending" | "confirmed"; autoApproved: boolean; confidence?: number };
import {elementInView,type ElementView} from "../spatial/visibility";
export {elementInView,type ElementView} from "../spatial/visibility";

/** Furniture and doors that share a narrow damage prompt. Walls stay on the full-frame pass. */
export function scopeFor(category: string): Scope | null {
  return scopeForName(category);
}
const NAMES: Record<string, string> = { table: "Table", cabinet: "Cabinet", door: "Door", wall: "Wall", chair: "Chair", sofa: "Sofa", bed: "Bed" };

import { project, projectPoint, sub, dot, axes, origin, hitElement, type V3 } from "./projection";
export { projectPoint };
/**
 * Which pieces to inspect when a photo is checked object by object. Take the largest of each
 * damage scope first, so a sofa filling the frame does not crowd out a door, then fill remaining
 * slots by size.
 */
export function selectInspectionTargets(views: ElementView[], limit = 4): ElementView[] {
  const eligible = views.filter(v => scopeFor(v.category)).sort((a, b) => b.area - a.area);
  const picked: ElementView[] = [];
  const seen = new Set<string>();
  for (const view of eligible) {
    const scope = scopeFor(view.category)!;
    if (seen.has(scope)) continue;
    seen.add(scope);
    picked.push(view);
    if (picked.length === limit) return picked;
  }
  for (const view of eligible) {
    if (picked.some(p => p.elementId === view.elementId)) continue;
    picked.push(view);
    if (picked.length === limit) break;
  }
  return picked;
}
const centre = (b: Box): [number, number] => [b.x + b.width / 2, b.y + b.height / 2];
const iou = (a: Box, b: Box) => { const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)), h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)), i = w * h; return i / (a.width * a.height + b.width * b.height - i || 1); };

/** Resolve a source-image box against measured room geometry, without calling any model. */
export function localizeDamageBox(box: Box | null, pose: FramePose, elements: RoomElement[], furnitureOnly = false): { owner: RoomElement | null; worldPosition: V3 | null } {
  if (!box) return { owner: null, worldPosition: null };
  const [px, py] = centre(box);
  const hits = elements.map(owner => ({ owner, hit: hitElement(px, py, pose, owner) })).filter(x => x.hit).sort((a, b) => a.hit!.t - b.hit!.t);
  const nearest = hits[0];
  // Do not shoot through an occluding wall to attach a mark to furniture behind it.
  if (!nearest || (furnitureOnly && !isFurniture(nearest.owner))) return { owner: null, worldPosition: null };
  return { owner: nearest.owner, worldPosition: nearest.hit!.point };
}

/**
 * Inspect all visible damage, associate boxes with measured geometry when possible, and publish
 * candidates before bounded verification. Findings without geometry keep their source-photo box.
 */
export async function analyzeEvidenceFrame(image: Buffer, pose: FramePose, elements: RoomElement[], options: { walls: boolean; onCandidates?: (findings: FrameFinding[]) => Promise<void>; observations?: DamageObservation[]; verify?: boolean; depth?: DepthPatch | null; specialist?: boolean; furnitureOnly?: boolean }) {
  const meta = await sharp(image).metadata();
  // The pose was recorded for the encoded size; rescale if the stored image differs.
  const scaled: FramePose = meta.width && meta.height && (meta.width !== pose.width || meta.height !== pose.height)
    ? { ...pose, intrinsics: pose.intrinsics.map((v, i) => i === 0 || i === 6 ? v * meta.width! / pose.width : i === 4 || i === 7 ? v * meta.height! / pose.height : v), width: meta.width, height: meta.height } : pose;
  const views = elements.map(e => elementInView(e, scaled)).filter((v): v is ElementView => !!v);
  const warnings: string[] = [];
  const out: FrameFinding[] = [];
  const add = (label: string, o: { type: string; description: string; boundingBox: Box | null }, element: RoomElement | null, source: FrameFinding["detectionSource"]) => {
    let worldPosition: V3 | null = null, owner = element;
    if (o.boundingBox) {
      const [px, py] = centre(o.boundingBox);
      if (element) worldPosition = hitElement(px, py, scaled, element)?.point ?? null;
      else { const located = localizeDamageBox(o.boundingBox, scaled, elements, options.furnitureOnly); owner = located.owner; worldPosition = located.worldPosition; }
    }
    // Never force a furniture defect onto a wall/fixture just because its ray crosses it.
    if (options.furnitureOnly && owner && !isFurniture(owner)) { owner = null; worldPosition = null; }
    const ownerScope = owner && scopeFor(owner.category);
    if (!element && owner) label = ownerScope ? NAMES[ownerScope] : owner.category;
    // Overlapping Gemini and specialist hypotheses are reported once.
    if (o.boundingBox && out.some(f => f.boundingBox && iou(f.boundingBox, o.boundingBox!) > .35)) return;
    out.push({ label: `${label}: ${o.type}`, description: o.description, damageType: o.type, boundingBox: o.boundingBox, elementId: owner?.id ?? null, elementCategory: owner?.category ?? (element ? element.category : "unassigned"), worldPosition, detectionSource: source, reviewStatus: "pending", autoApproved: false });
  };
  // Inspect the entire photo even before RoomPlan has recognized a surface or object.
  let wholeFailure: unknown;
  let publications: Promise<void> = Promise.resolve();
  const publish = () => {
    const snapshot = [...out];
    if (snapshot.length) publications = publications.then(async () => { await options.onCandidates?.(snapshot); });
    return publications;
  };
  // Argon is the only damage detector. Geometry is used after visual assessment.
  try {
    const whole = options.observations ?? await inspectVisibleDamage(image);
    whole.forEach(o => add('Visible damage', o, null, 'gemini'));
    await publish();
  } catch (error) { wholeFailure = error; logAIFailure('frame.damage', error); warnings.push(analysisFailure(error).message); }
  await publications;
  if (wholeFailure && !out.length) throw wholeFailure;
  // Cross-check: a second, adversarial Gemini look at each finding.
  const threshold = autoApproveThreshold();
  const pending = (options.verify === false || (wholeFailure && analysisFailure(wholeFailure).blocksService) ? [] : out.filter(f => f.boundingBox).slice(0, 6));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (cursor < pending.length) {
      const f = pending[cursor++];
      try {
        const v = await verifyFinding(image, { label: f.label, description: f.description, boundingBox: f.boundingBox! }, { timeoutMs: 20_000 });
        f.verification = { ...v, threshold }; f.confidence = v.verdict === 'damage' ? v.confidence : 1 - v.confidence;
        if (reviewDecision(v.verdict, v.confidence, threshold) === 'confirmed') { f.reviewStatus = 'confirmed'; f.autoApproved = true; }
      } catch (error) { logAIFailure('verify', error); /* Keep unverified candidates available for human review. */ }
    }
  }));
  // Findings the verifier is confident are not damage are dropped rather than shown.
  const kept = out.filter(f => !(f.verification && reviewDecision(f.verification.verdict, f.verification.confidence, threshold) === "rejected"));
  return { findings: kept, views, dropped: out.length - kept.length, warnings };
}
