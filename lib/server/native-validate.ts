/** Pure validators for phone payloads. Kept free of model imports so light routes stay small. */
export type NativePose = { transform: number[]; intrinsics: number[]; width: number; height: number };
export type NativeElement = { id: string; category: string; dimensions: [number, number, number]; transform: number[] };
/** COCO classes treated as furniture during a live scan (electronics are ignored). */
export const FURNITURE_CLASSES = new Set([56, 57, 59, 60]);

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
