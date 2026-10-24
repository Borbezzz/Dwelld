import type { FramePose, RoomElement } from "./frame-analysis";
/** Camera geometry shared by analysis and marker routes. No model imports, so routes using it stay small. */
export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const axes = (t: number[]): V3[] => [[t[0], t[1], t[2]], [t[4], t[5], t[6]], [t[8], t[9], t[10]]];
export const origin = (t: number[]): V3 => [t[12], t[13], t[14]];

/** World point to normalized image coordinates; null when behind the camera. */
export function projectPoint(p: V3, pose: FramePose) { return project(p, pose); }
export function project(p: V3, pose: FramePose): { x: number; y: number } | null {
  const t = pose.transform, k = pose.intrinsics, d = sub(p, origin(t)), [ax, ay, az] = axes(t);
  const cam: V3 = [dot(d, ax), dot(d, ay), dot(d, az)];
  if (cam[2] > -.15) return null;
  const depth = -cam[2];
  return { x: (k[0] * cam[0] / depth + k[6]) / pose.width, y: (k[7] - k[4] * cam[1] / depth) / pose.height };
}

/** Cast the image point into the room and return where it meets the element's box (slab test). */
export function hitElement(px: number, py: number, pose: FramePose, e: RoomElement): { point: V3; t: number } | null {
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

/** Where a normalized image point lands on the measured room: the nearest element along the camera ray. */
export function castIntoRoom(px: number, py: number, pose: FramePose, elements: RoomElement[]) {
  const hits = elements.map(owner => ({ owner, hit: hitElement(px, py, pose, owner) })).filter(x => x.hit).sort((a, b) => a.hit!.t - b.hit!.t);
  return hits[0] ? { element: hits[0].owner, point: hits[0].hit!.point } : null;
}
