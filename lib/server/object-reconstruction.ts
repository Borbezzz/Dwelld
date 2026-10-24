import sharp from "sharp";
import type { Document, ObjectId } from "mongodb";
import { getDb } from "./db";
import { readMedia } from "./media";
import { elementInView, type RoomElement } from "./frame-analysis";
import { isFurniture } from "../spatial/furniture";
import { measurementCaption, reconstructObject, type ObjectCloud } from "../spatial/object-reconstruction";
import type { SpatialElement, SpatialFrame, SpatialManifest } from "../spatial/types";

const METHOD = "multiview-depth-v1";
export type StoredCloud = ObjectCloud & { elementId: string; method: typeof METHOD; caption: string };

function framesFor(element: SpatialElement, frames: SpatialFrame[]) {
  const depth = frames.filter(frame => frame.depth && (frame.depthWidth || 0) > 2 && (frame.depthHeight || 0) > 2);
  const seen = depth.filter(frame => elementInView(element as RoomElement, frame));
  return (seen.length ? seen : depth).slice(0, 8);
}

async function viewsFor(manifest: SpatialManifest, frames: SpatialFrame[]) {
  const views = [];
  for (const frame of frames) {
    const width = frame.depthWidth || 0, height = frame.depthHeight || 0;
    const depthRef = manifest.assets.find(asset => asset.name === frame.depth && asset.kind === "depth")?.mediaRef;
    if (!depthRef) continue;
    const raw = await readMedia(depthRef, width * height * 4 + 64);
    if (raw.length < width * height * 4) continue;
    const depth = new Float32Array(width * height);
    for (let i = 0; i < depth.length; i++) depth[i] = raw.readFloatLE(i * 4);
    const confidenceRef = frame.confidence && manifest.assets.find(asset => asset.name === frame.confidence && asset.kind === "confidence")?.mediaRef;
    const confidenceRaw = confidenceRef ? await readMedia(confidenceRef, width * height + 64).catch(() => null) : null;
    const imageRef = manifest.assets.find(asset => asset.name === frame.image && asset.kind === "image")?.mediaRef;
    let color: Uint8Array | null = null;
    if (imageRef) {
      try {
        const jpeg = await readMedia(imageRef, 12 * 1024 * 1024);
        const rgb = await sharp(jpeg, { failOn: "none" }).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
        if (rgb.length >= width * height * 3) color = new Uint8Array(rgb.buffer, rgb.byteOffset, width * height * 3);
      } catch { color = null; }
    }
    views.push({ frame, depth, confidence: confidenceRaw && confidenceRaw.length >= width * height ? confidenceRaw : null, color });
  }
  return views;
}

function publish(elementId: string, cloud: ObjectCloud): StoredCloud {
  const { positions, colors, measurements, measuredAxes, views, points } = cloud;
  return { elementId, method: METHOD, positions, colors, measurements, measuredAxes, views, points, caption: measurementCaption(measuredAxes, views) };
}

/** Build this piece once per inspection, then serve the saved cloud. */
export async function reconstructionFor(inspection: Document, elementId: string): Promise<StoredCloud | null> {
  const db = await getDb();
  const inspectionId = inspection._id as ObjectId;
  const cached = await db.collection("objectReconstructions").findOne({ inspectionId, elementId, method: METHOD });
  if (cached?.unavailable) return null;
  if (cached?.positions && cached?.measurements) return publish(elementId, cached as unknown as ObjectCloud);
  const capture = await db.collection("spatialCaptures").findOne({ inspectionId }, { projection: { manifest: 1 } });
  const manifest = capture?.manifest as SpatialManifest | undefined;
  const element = manifest?.elements.find(item => item.id === elementId);
  if (!manifest || !element || !isFurniture(element)) return null;
  const cloud = reconstructObject(element, await viewsFor(manifest, framesFor(element, manifest.frames)));
  await db.collection("objectReconstructions").updateOne({ inspectionId, elementId }, { $set: { inspectionId, ownerId: inspection.ownerId, elementId, method: METHOD, ...(cloud ?? { unavailable: true }), createdAt: new Date() } }, { upsert: true });
  if (cloud) await db.collection("findings").updateOne({ inspectionId, kind: "object", spatialElementId: elementId }, { $set: { dimensions: [cloud.measurements.width, cloud.measurements.height, cloud.measurements.depth], description: measurementCaption(cloud.measuredAxes, cloud.views) } });
  return cloud ? publish(elementId, cloud) : null;
}

/** Warm the cache while the saved inspection is analysed, so selecting a piece in the demo is immediate. */
export async function prepareObjectReconstructions(inspection: Document, manifest: SpatialManifest) {
  const deadline = Date.now() + 25_000;
  for (const element of manifest.elements.filter(isFurniture).slice(0, 8)) {
    if (Date.now() > deadline) return;
    await reconstructionFor(inspection, element.id).catch(() => null);
  }
}
