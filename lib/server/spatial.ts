import type { SpatialManifest, Vec3, SpatialRegistration } from "@/lib/spatial/types";
export function vector(value: unknown): value is Vec3 { return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000); }
const matrix = (v: unknown, size: number) => Array.isArray(v) && v.length === size && v.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100000);
export function rigidTransform(v: unknown): v is number[] {
  if (!matrix(v, 16)) return false;
  const m = v as number[];
  if (Math.abs(m[3]) > 1e-5 || Math.abs(m[7]) > 1e-5 || Math.abs(m[11]) > 1e-5 || Math.abs(m[15] - 1) > 1e-5) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const dot = m[i * 4] * m[j * 4] + m[i * 4 + 1] * m[j * 4 + 1] + m[i * 4 + 2] * m[j * 4 + 2];
    if (Math.abs(dot - (i === j ? 1 : 0)) > .02) return false;
  }
  const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  return Math.abs(determinant - 1) < .02;
}
export function registration(value: unknown, sessionId: string): SpatialRegistration | undefined {
  if (value == null) return undefined;
  const r = value as SpatialRegistration;
  if (!r || r.sessionId !== sessionId || !["arkit-calibrated", "manual-calibration"].includes(r.source) || !rigidTransform(r.transform)) throw new Error("Invalid reconstruction registration");
  return { sessionId, source: r.source, transform: [...r.transform] };
}
const name = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_.-]{1,120}$/.test(v);
export function validateManifest(raw: unknown): SpatialManifest {
  const m = raw as SpatialManifest;
  if (!m || m.version !== 1 || !name(m.sessionId) || m.coordinateSystem !== "arkit-right-handed-y-up-metres" || !Array.isArray(m.elements) || m.elements.length > 1000 || !Array.isArray(m.frames) || m.frames.length > 600 || !Array.isArray(m.assets) || m.assets.length > 1805) throw new Error("Invalid spatial manifest");
  const ids = new Set<string>(), assets = new Set<string>();
  for (const a of m.assets) { if (!name(a.name) || assets.has(a.name) || !/^gridfs:[a-f0-9]{24}$/.test(a.mediaRef) || !["image", "depth", "confidence", "usdz", "splat"].includes(a.kind)) throw new Error("Invalid spatial asset"); assets.add(a.name); }
  for (const e of m.elements) { if (!name(e.id) || ids.has(e.id) || typeof e.category !== "string" || e.category.length > 100 || !vector(e.dimensions) || e.dimensions.some(n => n < 0) || e.dimensions.filter(n => n > 0).length < 2 || !rigidTransform(e.transform)) throw new Error("Invalid spatial geometry"); ids.add(e.id); }
  for (const f of m.frames) if (!Number.isFinite(f.timestamp) || f.timestamp < 0 || !rigidTransform(f.transform) || !matrix(f.intrinsics, 9) || !Number.isInteger(f.width) || !Number.isInteger(f.height) || f.width < 1 || f.height < 1 || !assets.has(f.image) || (f.depth && !assets.has(f.depth)) || (f.confidence && !assets.has(f.confidence))) throw new Error("Invalid spatial frame");
  return {
    version: 1, sessionId: m.sessionId, coordinateSystem: m.coordinateSystem,
    elements: m.elements.map(e => ({ id: e.id, category: e.category, dimensions: [...e.dimensions] as Vec3, transform: [...e.transform] })),
    frames: m.frames.map(f => ({ timestamp: f.timestamp, image: f.image, ...(f.depth ? { depth: f.depth, depthWidth: f.depthWidth, depthHeight: f.depthHeight } : {}), ...(f.confidence ? { confidence: f.confidence } : {}), width: f.width, height: f.height, intrinsics: [...f.intrinsics], transform: [...f.transform] })),
    assets: m.assets.map(a => ({ name: a.name, mediaRef: a.mediaRef, kind: a.kind, ...(a.kind === "splat" && a.registration ? { registration: registration(a.registration, m.sessionId) } : {}) })),
  };
}
