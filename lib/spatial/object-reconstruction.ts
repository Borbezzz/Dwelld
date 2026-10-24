import { insideElement, worldPoint } from "./identity";
import type { SpatialElement, SpatialFrame, Vec3 } from "./types";

/** One calibrated photo whose depth map shares the camera frame. Colour is optional RGB aligned to the depth grid. */
export type DepthView = { frame: SpatialFrame; depth: ArrayLike<number>; confidence?: ArrayLike<number> | null; color?: ArrayLike<number> | null };
export type ObjectCloud = {
  positions: number[]; colors: number[];
  measurements: { width: number; height: number; depth: number };
  measuredAxes: [boolean, boolean, boolean]; views: number; points: number;
};

const AXIS = ["Width", "Height", "Depth"] as const;

/**
 * Rebuild one piece from the inspection's own calibrated photos.
 * Each high-confidence depth sample is cast into the room and kept only when it lands inside that piece.
 * A measurement replaces the scan size only when the photos actually cover that axis.
 */
export function reconstructObject(element: SpatialElement, views: DepthView[]): ObjectCloud | null {
  const cells = new Map<string, { x: number; y: number; z: number; r: number; g: number; b: number; n: number }>();
  let used = 0;
  for (const view of views) {
    const w = view.frame.depthWidth || 0, h = view.frame.depthHeight || 0;
    if (w < 3 || h < 3 || view.depth.length < w * h) continue;
    const confidence = view.confidence && view.confidence.length >= w * h ? view.confidence : null;
    const color = view.color && view.color.length >= w * h * 3 ? view.color : null;
    const stride = Math.max(1, Math.floor(Math.min(w, h) / 80));
    let added = 0;
    for (let y = 1; y < h - 1; y += stride) {
      for (let x = 1; x < w - 1; x += stride) {
        const i = y * w + x, z = view.depth[i];
        if ((confidence && confidence[i] !== 2) || !Number.isFinite(z) || z < 0.2 || z > 6) continue;
        const left = view.depth[i - 1], right = view.depth[i + 1];
        if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - z) > 0.08 || Math.abs(right - z) > 0.08) continue;
        const world = worldPoint(view.frame, (x + 0.5) / w, (y + 0.5) / h, z);
        if (!world || !insideElement(world, element, 0.03)) continue;
        const key = `${Math.floor(world[0] / 0.02)}:${Math.floor(world[1] / 0.02)}:${Math.floor(world[2] / 0.02)}`;
        const r = color ? color[i * 3] : 196, g = color ? color[i * 3 + 1] : 168, b = color ? color[i * 3 + 2] : 130;
        const cell = cells.get(key);
        if (cell) { cell.x += world[0]; cell.y += world[1]; cell.z += world[2]; cell.r += r; cell.g += g; cell.b += b; cell.n += 1; }
        else cells.set(key, { x: world[0], y: world[1], z: world[2], r, g, b, n: 1 });
        added += 1;
      }
    }
    if (added) used += 1;
  }
  let entries = [...cells.values()];
  if (entries.length < 40 || used < 1) return null;
  if (entries.length > 5000) { const step = Math.ceil(entries.length / 5000); entries = entries.filter((_, index) => index % step === 0); }
  const positions: number[] = [], colors: number[] = [], local: [number, number, number][] = [];
  const transform = element.transform, origin = [transform[12], transform[13], transform[14]];
  const axes: Vec3[] = [[transform[0], transform[1], transform[2]], [transform[4], transform[5], transform[6]], [transform[8], transform[9], transform[10]]];
  for (const cell of entries) {
    const point: Vec3 = [cell.x / cell.n, cell.y / cell.n, cell.z / cell.n];
    positions.push(...point);
    colors.push(Math.round(cell.r / cell.n), Math.round(cell.g / cell.n), Math.round(cell.b / cell.n));
    const delta = point.map((value, index) => value - origin[index]);
    local.push(axes.map(axis => axis.reduce((sum, value, index) => sum + value * delta[index], 0)) as [number, number, number]);
  }
  const spans = [0, 1, 2].map(axis => {
    const values = local.map(point => point[axis]).sort((a, b) => a - b);
    return values[Math.floor(values.length * 0.98)] - values[Math.floor(values.length * 0.02)];
  });
  const measuredAxes = spans.map((span, axis) => span >= element.dimensions[axis] * 0.55 && span <= element.dimensions[axis] * 1.25) as [boolean, boolean, boolean];
  const size = spans.map((span, axis) => measuredAxes[axis] ? Math.round(span * 100) / 100 : element.dimensions[axis]);
  return { positions, colors, measurements: { width: size[0], height: size[1], depth: size[2] }, measuredAxes, views: used, points: entries.length };
}

export function measurementCaption(measuredAxes: [boolean, boolean, boolean], views: number): string {
  const photos = AXIS.filter((_, index) => measuredAxes[index]), scan = AXIS.filter((_, index) => !measuredAxes[index]);
  const view = `${views} calibrated photo ${views === 1 ? "view" : "views"}`;
  if (photos.length === 3) return `Reconstructed from ${view} in this inspection.`;
  if (!photos.length) return `Shown from the inspection photos. Measurements stay with the scan because those views did not cover the whole piece.`;
  const label = (names: readonly string[]) => { const words = names.map((name, index) => index ? name.toLowerCase() : name); return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`; };
  return `${label(photos)} reconstructed from ${view}. ${label(scan)} kept from the scan.`;
}
