import type { SpatialElement } from "./types";

/** RoomPlan object categories that count as furniture. Walls, floors, openings, appliances and electronics are left out. */
const FURNITURE = new Set(["bed", "sofa", "chair", "table", "storage"]);
const NAMES: Record<string, string> = { bed: "Bed", sofa: "Sofa", chair: "Chair", table: "Table", storage: "Storage" };
/** YOLO labels that describe furniture (electronics such as tv or laptop are ignored). */
const FURNITURE_LABELS = /^(chair|couch|sofa|bed|dining table|table|desk|bench|wardrobe|cabinet|drawers?|dresser|bookshelf|shelf|storage)\b/i;

export function categoryKey(category: string) { return category.toLowerCase().replace(/[^a-z]/g, ""); }
export function isFurniture(element: Pick<SpatialElement, "category">) { return FURNITURE.has(categoryKey(element.category)); }
export function isFurnitureLabel(label: string) { return FURNITURE_LABELS.test(label.trim()); }
export function isStructure(element: Pick<SpatialElement, "category">) { return /wall|floor|door|window|opening/i.test(element.category); }
export function furnitureName(element: Pick<SpatialElement, "category">) { return NAMES[categoryKey(element.category)] || element.category; }
/** Number repeated furniture types: Chair 1, Chair 2. */
export function furnitureNames(elements: SpatialElement[]) {
  const counts = new Map<string, number>(), totals = new Map<string, number>();
  elements.forEach(e => totals.set(categoryKey(e.category), (totals.get(categoryKey(e.category)) || 0) + 1));
  return new Map(elements.map(e => { const key = categoryKey(e.category), n = (counts.get(key) || 0) + 1; counts.set(key, n); return [e.id, (totals.get(key) || 0) > 1 ? `${furnitureName(e)} ${n}` : furnitureName(e)]; }));
}
