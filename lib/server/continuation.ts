import type { Document } from "mongodb";
import { getDb } from "./db";
import { deleteMedia, readMedia, writeMedia } from "./media";
import { isFurniture, categoryKey } from "../spatial/furniture";
import type { SpatialElement, SpatialFrame, SpatialManifest } from "../spatial/types";
import type { SessionDoc } from "./live-sessions";

/**
 * Resume a room scan later. The phone saves an ARWorldMap with every scan; a continuation session
 * relocalizes into it, so the new part arrives in the original scan's coordinates. Here it is folded
 * into the original capture: frames and photos appended, new furniture added, splats merged.
 */

const MAX_SPLATS = 180_000;
const MAX_FRAMES = 600, MAX_ASSETS = 1805;

type Ply = { props: string; count: number; stride: number; body: Buffer };
function splitPly(buf: Buffer): Ply | null {
  const end = buf.indexOf("end_header\n");
  if (end < 0) return null;
  const header = buf.subarray(0, end + 11).toString("latin1");
  const vertex = /element vertex (\d+)\n/.exec(header);
  if (!vertex || !header.includes("format binary_little_endian")) return null;
  const props = header.slice(vertex.index + vertex[0].length);
  if (/^property (?!float )/m.test(props) || /^element /m.test(props)) return null;
  const count = Number(vertex[1]), stride = (props.match(/^property float /gm) || []).length * 4;
  const body = buf.subarray(end + 11, end + 11 + count * stride);
  return stride && body.length === count * stride ? { props, count, stride, body } : null;
}
/** Concatenate two LiDAR-initialized PLYs with the same layout, thinned evenly to the splat budget. */
export function mergePly(a: Buffer, b: Buffer, parts: number): Buffer | null {
  const x = splitPly(a), y = splitPly(b);
  if (!x || !y || x.props !== y.props) return null;
  const total = x.count + y.count, step = Math.max(1, Math.ceil(total / MAX_SPLATS)), kept = Math.ceil(total / step);
  const out = Buffer.alloc(kept * x.stride);
  let n = 0;
  for (let i = 0; i < total && n < kept; i += step) {
    const [src, at] = i < x.count ? [x.body, i] : [y.body, i - x.count];
    src.copy(out, n * x.stride, at * x.stride, (at + 1) * x.stride); n++;
  }
  const head = `ply\nformat binary_little_endian 1.0\ncomment Dwelld LiDAR-initialized preview merged from ${parts} scans; not photometrically optimized\nelement vertex ${n}\n${x.props}`;
  return Buffer.concat([Buffer.from(head, "latin1"), out.subarray(0, n * x.stride)]);
}

const centre = (e: SpatialElement) => [e.transform[12], e.transform[13], e.transform[14]];
/** The same piece seen again from the second scan: same category, centre within a hand's width. */
function alreadyMeasured(e: SpatialElement, existing: SpatialElement[]) {
  const c = centre(e), limit = isFurniture(e) ? .35 : .3;
  return existing.some(b => categoryKey(b.category) === categoryKey(e.category) && Math.hypot(...centre(b).map((v, i) => v - c[i])) < limit);
}

export async function saveContinuation(session: SessionDoc, part: SpatialManifest) {
  const db = await getDb(), inspectionId = session.continueFrom!;
  const capture = await db.collection("spatialCaptures").findOne({ inspectionId, ownerId: session.ownerId });
  const inspection = await db.collection("inspections").findOne({ _id: inspectionId, ownerId: session.ownerId });
  if (!capture || !inspection) throw new Error("The earlier scan no longer exists");
  // A retried save of the same part is acknowledged, never appended twice.
  const parts = (capture.parts as { sessionId: string; timestampOffset?: number }[] | undefined) || [];
  const savedPart = parts.find(p => p.sessionId === String(session._id));
  if (savedPart) return { inspection, analysis: null, timestampOffset:savedPart.timestampOffset||0 };

  const base = capture.manifest as SpatialManifest, index = parts.length + 2, prefix = `p${index}-`;
  const rename = (name: string) => (prefix + name).slice(0, 120);
  const names = new Set(base.assets.map(a => a.name));
  const offset = Math.max(base.frames.at(-1)?.timestamp ?? 0, ...base.assets.filter(a=>a.kind==="video").map(a=>(a.startTimeSeconds||0)+(a.durationSeconds||0))) + 1;
  const room = Math.max(0, Math.min(MAX_FRAMES - base.frames.length, part.frames.length));
  const frames: SpatialFrame[] = part.frames.slice(0, room).map(f => ({ ...f, timestamp: f.timestamp + offset, image: rename(f.image), ...(f.depth ? { depth: rename(f.depth) } : {}), ...(f.confidence ? { confidence: rename(f.confidence) } : {}) }));
  const used = new Set(frames.flatMap(f => [f.image, f.depth, f.confidence].filter(Boolean) as string[]));
  const media = part.assets.filter(a => ["image", "depth", "confidence"].includes(a.kind)).map(a => ({ ...a, name: rename(a.name) })).filter(a => used.has(a.name) && !names.has(a.name));

  const recordings = part.assets.filter(a => a.kind === "video").map(a => ({...a,name:rename(a.name),startTimeSeconds:(a.startTimeSeconds || 0) + offset}));
  const added = part.elements.filter(e => !alreadyMeasured(e, base.elements) && !base.elements.some(b => b.id === e.id));
  const cleanup: string[] = [];

  // Splat: merge the new LiDAR points into the earlier preview so the room page shows one space.
  let assets = base.assets.filter(a => a.kind !== "worldmap");
  const oldSplat = base.assets.find(a => a.kind === "splat"), newSplat = part.assets.find(a => a.kind === "splat");
  if (newSplat) {
    let merged: Buffer | null = null;
    if (oldSplat?.reconstructionMethod === "lidar-initialized") {
      try { merged = mergePly(await readMedia(oldSplat.mediaRef, 40 * 1024 * 1024), await readMedia(newSplat.mediaRef, 40 * 1024 * 1024), index); } catch { merged = null; }
    }
    if (merged) {
      const ref = await writeMedia(merged, `room-merged-${index}.ply`, "application/octet-stream", { ownerId: session.ownerId, liveSessionId: String(session._id), kind: "splat" });
      assets = assets.map(a => a === oldSplat ? { name: `room-preview-${index}.ply`, mediaRef: ref, kind: "splat" as const, reconstructionMethod: "lidar-initialized" as const, ...(oldSplat.registration ? { registration: oldSplat.registration } : {}) } : a);
      cleanup.push(oldSplat!.mediaRef, newSplat.mediaRef);
    } else if (!oldSplat) {
      assets.push({ name: rename(newSplat.name), mediaRef: newSplat.mediaRef, kind: "splat", reconstructionMethod: "lidar-initialized" });
    }
  }
  // The newest world map covers both parts, so the next continuation can lock on anywhere.
  const oldMap = base.assets.find(a => a.kind === "worldmap"), newMap = part.assets.find(a => a.kind === "worldmap");
  const map = newMap ? { name: rename(newMap.name), mediaRef: newMap.mediaRef, kind: "worldmap" as const } : oldMap;
  if (newMap && oldMap) cleanup.push(oldMap.mediaRef);
  if (assets.length + recordings.length + (map ? 1 : 0) > MAX_ASSETS) throw new Error("This room has reached its capture asset limit. Start a new inspection to retain the recording.");
  assets = [...assets, ...recordings, ...media.slice(0, Math.max(0, MAX_ASSETS - assets.length - recordings.length - 1)), ...(map ? [map] : [])];

  const manifest: SpatialManifest = { ...base, elements: [...base.elements, ...added].slice(0, 1000), frames: [...base.frames, ...frames], assets };
  const result = await db.collection("spatialCaptures").updateOne(
    { _id: capture._id, "parts.sessionId": { $ne: String(session._id) } },
    { $set: { manifest, updatedAt: new Date() }, $push: { parts: { sessionId: String(session._id), timestampOffset:offset, frames: frames.length, elements: added.length, addedAt: new Date() } } } as never,
  );
  if (result.modifiedCount) for (const ref of cleanup) await deleteMedia(ref).catch(() => {});
  else return { inspection, analysis: null, timestampOffset:offset };
  // Analyse only the new photos; furniture that was already measured keeps its findings.
  return { inspection: inspection as Document, timestampOffset:offset, analysis: { manifest: { ...manifest, frames }, objectElementIds: added.map(e => e.id) } };
}
