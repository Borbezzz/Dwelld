type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
/** Raw ARKit sensor coordinates -> upright portrait display, clockwise 90 degrees. */
export function portraitEvidencePoint(point: Point): Point {
  return { x: 1 - point.y, y: point.x };
}
export function portraitEvidenceBox(box: Box): Box {
  return { x: 1 - box.y - box.height, y: box.x, width: box.height, height: box.width };
}
