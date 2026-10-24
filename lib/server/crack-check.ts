import sharp from "sharp";
import type { Box } from "./damage";

/**
 * Is this "crack" a crack, or the edge of something?
 *
 * Plain edge detection can't tell, because a whiteboard frame, a door gap and a shelf edge are
 * stronger edges than any hairline crack. Two things separate them:
 *  1. Profile across the line. A crack is a thin dark valley with the same surface on both sides.
 *     An object boundary is a step: one side is a different brightness from the other.
 *     Long, perfectly straight lines that span the whole box are manufactured edges.
 *  2. LiDAR depth. A crack lies on one continuous surface, so depth is the same on both sides.
 *     A board on a wall, a door in its frame or a gap has a depth step across the line.
 */
export type DepthPatch = { data: Float32Array; width: number; height: number; confidence?: Uint8Array };
export type CrackCheck = { verdict: "crack" | "edge" | "uncertain"; straightness: number; span: number; valley: number; step: number; depthStep: number | null; reason: string };

const SIZE = 160;

function sobel(g: Uint8Array, w: number, h: number) {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, a = (dx: number, dy: number) => g[i + dy * w + dx];
    const gx = -a(-1, -1) - 2 * a(-1, 0) - a(-1, 1) + a(1, -1) + 2 * a(1, 0) + a(1, 1);
    const gy = -a(-1, -1) - 2 * a(0, -1) - a(1, -1) + a(-1, 1) + 2 * a(0, 1) + a(1, 1);
    mag[i] = Math.hypot(gx, gy) / 4;
  }
  return mag;
}

/** The dominant straight line through the strongest edge pixels (Hough transform). */
export function dominantLine(points: [number, number][], w: number, h: number) {
  const diag = Math.ceil(Math.hypot(w, h)), thetas = 90, acc = new Uint32Array(thetas * (2 * diag + 1));
  const cs = Array.from({ length: thetas }, (_, t) => [Math.cos(t * Math.PI / thetas), Math.sin(t * Math.PI / thetas)]);
  for (const [x, y] of points) for (let t = 0; t < thetas; t++) acc[t * (2 * diag + 1) + Math.round(x * cs[t][0] + y * cs[t][1]) + diag]++;
  let best = 0, bt = 0, br = 0;
  for (let t = 0; t < thetas; t++) for (let r = 0; r <= 2 * diag; r++) { const v = acc[t * (2 * diag + 1) + r]; if (v > best) { best = v; bt = t; br = r - diag; } }
  const [c, s] = cs[bt], inliers = points.filter(([x, y]) => Math.abs(x * c + y * s - br) <= 1.5);
  const along = inliers.map(([x, y]) => -x * s + y * c);
  const span = along.length ? (Math.max(...along) - Math.min(...along)) / Math.hypot(w, h) : 0;
  return { cos: c, sin: s, rho: br, inliers, straightness: points.length ? inliers.length / points.length : 0, span };
}

/** Brightness across the line: a valley (crack) versus a step (boundary). Values are 0–1. */
export function crossProfile(g: Uint8Array, w: number, h: number, line: ReturnType<typeof dominantLine>) {
  const at = (x: number, y: number) => g[Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))];
  let valley = 0, step = 0, n = 0;
  const stride = Math.max(1, Math.floor(line.inliers.length / 60));
  for (let k = 0; k < line.inliers.length; k += stride) {
    const [x, y] = line.inliers[k], nx = line.cos, ny = line.sin;
    let centre = 255; for (let t = -3; t <= 3; t++) centre = Math.min(centre, at(x + t * nx, y + t * ny));
    const L = (at(x - 7 * nx, y - 7 * ny) + at(x - 9 * nx, y - 9 * ny)) / 2, R = (at(x + 7 * nx, y + 7 * ny) + at(x + 9 * nx, y + 9 * ny)) / 2;
    valley += Math.max(0, Math.min(L, R) - centre); step += Math.abs(L - R); n++;
  }
  return { valley: n ? valley / n / 255 : 0, step: n ? step / n / 255 : 0 };
}

/** Depth difference across the line after removing the surface's tilt (metres). Null without enough depth. */
export function depthStepAcross(depth: DepthPatch, region: { x: number; y: number; w: number; h: number }, side: (u: number, v: number) => number) {
  const pts: { u: number; v: number; z: number; s: number }[] = [];
  const x0 = Math.floor(region.x * depth.width), x1 = Math.ceil((region.x + region.w) * depth.width), y0 = Math.floor(region.y * depth.height), y1 = Math.ceil((region.y + region.h) * depth.height);
  for (let y = Math.max(0, y0); y < Math.min(depth.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(depth.width, x1); x++) {
    const i = y * depth.width + x, z = depth.data[i];
    if (!Number.isFinite(z) || z < .1 || z > 8 || (depth.confidence && depth.confidence[i] < 2)) continue;
    const u = (x + .5) / depth.width, v = (y + .5) / depth.height, s = side(u, v);
    if (Math.abs(s) < 1.5) continue; // skip samples right on the line
    pts.push({ u, v, z, s: Math.sign(s) });
  }
  const a = pts.filter(p => p.s < 0), b = pts.filter(p => p.s > 0);
  if (a.length < 4 || b.length < 4) return null;
  // One surface plus a step across the line: z = a·u + b·v + c + d·side. A tilted wall fits a, b;
  // a board, door or gap shows up as d. Least squares on the 4×4 normal equations.
  const rows = pts.map(p => [p.u, p.v, 1, p.s / 2]), N = rows[0].length;
  const A = Array.from({ length: N }, (_, i) => Array.from({ length: N + 1 }, (_, j) => j < N ? rows.reduce((t, r) => t + r[i] * r[j], 0) : rows.reduce((t, r, k) => t + r[i] * pts[k].z, 0)));
  for (let c = 0; c < N; c++) {
    let piv = c; for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < N; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= N; j++) A[r][j] -= f * A[c][j]; }
  }
  return Math.abs(A[3][N] / A[3][3]);
}

export async function checkCrack(image: Buffer, box: Box, depth?: DepthPatch | null): Promise<CrackCheck> {
  const meta = await sharp(image).metadata(), W = meta.width || 0, H = meta.height || 0;
  const pad = .2, rx = Math.max(0, box.x - box.width * pad), ry = Math.max(0, box.y - box.height * pad);
  const region = { x: rx, y: ry, w: Math.min(1 - rx, box.width * (1 + 2 * pad)), h: Math.min(1 - ry, box.height * (1 + 2 * pad)) };
  const left = Math.floor(region.x * W), top = Math.floor(region.y * H), width = Math.max(8, Math.min(W - left, Math.round(region.w * W))), height = Math.max(8, Math.min(H - top, Math.round(region.h * H)));
  const { data, info } = await sharp(image).extract({ left, top, width, height }).greyscale().resize({ width: SIZE, height: SIZE, fit: "inside" }).blur(.6).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, g = new Uint8Array(data.buffer, data.byteOffset, w * h);
  const mag = sobel(g, w, h), sorted = Array.from(mag).sort((a, b) => a - b), cut = Math.max(12, sorted[Math.floor(sorted.length * .92)]);
  const points: [number, number][] = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (mag[y * w + x] >= cut) points.push([x, y]);
  if (points.length < 25) return { verdict: "uncertain", straightness: 0, span: 0, valley: 0, step: 0, depthStep: null, reason: "Too little detail in the box to check its edges." };
  const line = dominantLine(points, w, h), { valley, step } = crossProfile(g, w, h, line);
  const depthStep = depth ? depthStepAcross(depth, region, (u, v) => ((u - region.x) / region.w * w) * line.cos + ((v - region.y) / region.h * h) * line.sin - line.rho) : null;
  const base = { straightness: +line.straightness.toFixed(3), span: +line.span.toFixed(3), valley: +valley.toFixed(3), step: +step.toFixed(3), depthStep: depthStep == null ? null : +depthStep.toFixed(4) };
  if (depthStep != null && depthStep >= .012) return { ...base, verdict: "edge", reason: `LiDAR depth changes by ${(depthStep * 100).toFixed(1)} cm across the line, so it is the edge of an object or a gap, not a crack in one surface.` };
  if (step > Math.max(.08, .5 * valley)) return { ...base, verdict: "edge", reason: "Brightness steps from one side of the line to the other, like the border of a board, frame or door, rather than a thin dark crack." };
  if (line.straightness > .6 && line.span > .75 && valley < .12) return { ...base, verdict: "edge", reason: "A long, perfectly straight line across the whole area looks like a manufactured edge or joint." };
  if (valley > .05 && valley > step) return { ...base, verdict: "crack", reason: `A thin dark line with the same surface on both sides${depthStep != null ? " and no depth step" : ""}, which is consistent with a crack.` };
  return { ...base, verdict: "uncertain", reason: "The edge check could not tell a crack from an edge here." };
}
