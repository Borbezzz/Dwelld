import {analysisFailure} from "./analysis-failure";
import sharp from "sharp";
import { inspectCracks } from "./crack-detector";
import { inspectVisibleDamage, scopeForName, type DamageObservation, type Box } from "./damage";
import { verifyFinding, autoApproveThreshold, reviewDecision, type Verdict } from "./verify";

/** Camera pose of one evidence photo, in the scan's world space (ARKit, metres, Y up, column-major). */
export type FramePose = { transform: number[]; intrinsics: number[]; width: number; height: number };
export type RoomElement = { id: string; category: string; dimensions: number[]; transform: number[] };
type Scope = NonNullable<ReturnType<typeof scopeForName>>;
export type FrameFinding = { label: string; description: string; damageType: string; boundingBox: Box | null; elementId: string | null; elementCategory: string; worldPosition: [number, number, number] | null; detectionSource: "gemini" | "crack-model"; verification?: Verdict & { threshold: number }; reviewStatus: "pending" | "confirmed"; autoApproved: boolean; confidence?: number };
export type ElementView = { elementId: string; category: string; box: Box; area: number };

/** Furniture and doors that share a narrow damage prompt. Walls stay on the full-frame pass. */
export function scopeFor(category: string): Scope | null {
  return scopeForName(category);
}
const NAMES: Record<string, string> = { table: "Table", cabinet: "Cabinet", door: "Door", wall: "Wall", chair: "Chair", sofa: "Sofa", bed: "Bed" };

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const axes = (t: number[]): V3[] => [[t[0], t[1], t[2]], [t[4], t[5], t[6]], [t[8], t[9], t[10]]];
const origin = (t: number[]): V3 => [t[12], t[13], t[14]];

/** World point to normalized image coordinates; null when behind the camera. */
export function projectPoint(p: V3, pose: FramePose) { return project(p, pose); }
function project(p: V3, pose: FramePose): { x: number; y: number } | null {
  const t = pose.transform, k = pose.intrinsics, d = sub(p, origin(t)), [ax, ay, az] = axes(t);
  const cam: V3 = [dot(d, ax), dot(d, ay), dot(d, az)];
  if (cam[2] > -.15) return null;
  const depth = -cam[2];
  return { x: (k[0] * cam[0] / depth + k[6]) / pose.width, y: (k[7] - k[4] * cam[1] / depth) / pose.height };
}
/** Where a furniture piece sits in this photo, if it is clearly in view. */
export function elementInView(e: RoomElement, pose: FramePose): ElementView | null {
  const [ax, ay, az] = axes(e.transform), o = origin(e.transform), h = e.dimensions.map(v => Math.max(v, .02) / 2);
  const pts: { x: number; y: number }[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p: V3 = [0, 1, 2].map(i => o[i] + ax[i] * sx * h[0] + ay[i] * sy * h[1] + az[i] * sz * h[2]) as V3;
    const q = project(p, pose); if (q) pts.push(q);
  }
  // One edge may cross the camera plane (a close look at a door or tabletop). Two missing edges is not a usable view.
  if (pts.length < 6) return null;
  const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  const cx0 = Math.max(0, x0), cx1 = Math.min(1, x1), cy0 = Math.max(0, y0), cy1 = Math.min(1, y1);
  if (cx1 <= cx0 || cy1 <= cy0) return null;
  const visible = (cx1 - cx0) * (cy1 - cy0), full = (x1 - x0) * (y1 - y0);
  if (visible < .03 || visible / full < .55) return null; // too small, or mostly out of frame
  const pad = .04;
  const box = { x: Math.max(0, cx0 - pad), y: Math.max(0, cy0 - pad), width: 0, height: 0 };
  box.width = Math.min(1, cx1 + pad) - box.x; box.height = Math.min(1, cy1 + pad) - box.y;
  return { elementId: e.id, category: e.category, box, area: visible };
}

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
/** Cast the image point into the room and return where it meets the element's box (slab test). */
function hitElement(px: number, py: number, pose: FramePose, e: RoomElement): { point: V3; t: number } | null {
  const t = pose.transform, k = pose.intrinsics, [cx, cy, cz] = axes(t), o = origin(t);
  const local: V3 = [(px * pose.width - k[6]) / k[0], -(py * pose.height - k[7]) / k[4], -1];
  const dir = [0, 1, 2].map(i => cx[i] * local[0] + cy[i] * local[1] + cz[i] * local[2]) as V3;
  const [ex, ey, ez] = axes(e.transform), rel = sub(o, origin(e.transform)), h = e.dimensions.map(v => Math.max(v, .03) / 2);
  let near = -Infinity, far = Infinity;
  for (const [i, a] of [ex, ey, ez].entries()) {
    const ro = dot(rel, a), rd = dot(dir, a);
    if (Math.abs(rd) < 1e-6) { if (Math.abs(ro) > h[i]) return null; continue; }
    let t0 = (-h[i] - ro) / rd, t1 = (h[i] - ro) / rd; if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0); far = Math.min(far, t1); if (near > far) return null;
  }
  const hit = near > .1 ? near : far > .1 ? far : null; if (hit === null) return null;
  return { point: [0, 1, 2].map(i => o[i] + dir[i] * hit) as V3, t: hit };
}
const centre = (b: Box): [number, number] => [b.x + b.width / 2, b.y + b.height / 2];
const iou = (a: Box, b: Box) => { const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)), h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)), i = w * h; return i / (a.width * a.height + b.width * b.height - i || 1); };

/**
 * Inspect all visible damage, associate boxes with measured geometry when possible, and publish
 * candidates before bounded verification. Findings without geometry keep their source-photo box.
 */
export async function analyzeEvidenceFrame(image: Buffer, pose: FramePose, elements: RoomElement[], options: { walls: boolean; onCandidates?: (findings: FrameFinding[]) => Promise<void>; observations?: DamageObservation[]; verify?: boolean }) {
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
      else { const hits = elements.map(w => ({ w, h: hitElement(px, py, scaled, w) })).filter(x => x.h).sort((a, b) => a.h!.t - b.h!.t); if (hits[0]) { owner = hits[0].w; worldPosition = hits[0].h!.point; } }
    }
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
  // Independent services publish as they finish. Gemini failure must not discard crack candidates.
  await Promise.all([
    (async () => {
      let whole: DamageObservation[] = [];
      try { whole = options.observations ?? await inspectVisibleDamage(image); }
      catch (error) { wholeFailure = error; warnings.push(analysisFailure(error).message); }
      whole.forEach(o => add('Visible damage', o, null, 'gemini'));
      await publish();
    })(),
    (async () => {
      let cracks: Awaited<ReturnType<typeof inspectCracks>> = [];
      try { cracks = await inspectCracks(image); }
      catch { warnings.push('Specialist crack check was unavailable.'); }
      cracks.forEach(o => add('Potential crack', { type: 'crack', description: 'Specialist crack candidate; requires cross-checking against the photo.', boundingBox: o.boundingBox }, null, 'crack-model'));
      await publish();
    })(),
  ]);
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
      } catch { /* Keep unverified candidates available for human review. */ }
    }
  }));
  // Findings the verifier is confident are not damage are dropped rather than shown.
  const kept = out.filter(f => !(f.verification && reviewDecision(f.verification.verdict, f.verification.confidence, threshold) === "rejected"));
  return { findings: kept, views, dropped: out.length - kept.length, warnings };
}
