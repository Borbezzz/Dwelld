import {analysisFailure} from "./analysis-failure";
import { analyzeFurnitureVideoFrames, oneFramePerSecond } from "./furniture-video";
import { ObjectId, type Document } from "mongodb";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { readMedia } from "./media";
import { indexFindings } from "./search";
import type { DepthPatch } from "./crack-check";
import { elementInView, localizeDamageBox, type FrameFinding, type FramePose, type RoomElement } from "./frame-analysis";
import { insideElement } from "../spatial/identity";
import { prepareObjectReconstructions } from "./object-reconstruction";
import { furnitureNames, isFurniture } from "../spatial/furniture";
import type { SpatialManifest, SpatialElement } from "../spatial/types";

/** Live: batch every queued second in order. No per-finding or per-object provider calls. */
export async function analyzeLiveEvidenceFrame(sessionId: ObjectId, _name: string) {
  const db = await getDb(), frames = db.collection("liveFrames"), sessions = db.collection("liveSessions");
  const lease = randomUUID();
  // A single session worker avoids duplicate batch reasoning and out-of-order completion.
  const claimed = await sessions.findOneAndUpdate({ _id: sessionId, $or: [{ 'furnitureWorker.until': { $exists: false } }, { 'furnitureWorker.until': { $lte: new Date() } }] }, { $set: { furnitureWorker: { lease, until: new Date(Date.now() + 295_000) } } });
  if (!claimed) return;
  const deadline = Date.now() + 180_000;
  try {
    while (Date.now() < deadline) {
      const session = await sessions.findOne({ _id: sessionId });
      if (session?.status === 'saved' || session?.analysisIssue?.blocksService) break;
      const batch: Document[] = [];
      for (let i = 0; i < 6; i++) {
        const frame = await frames.findOneAndUpdate({ sessionId, status: 'queued' }, { $set: { status: 'analyzing', startedAt: new Date() } }, { sort: { timestampSeconds: 1 }, returnDocument: 'after' });
        if (!frame) break;
        batch.push(frame);
      }
      if (!batch.length) break;
      try {
        const images = await Promise.all(batch.map(async frame => ({ ...frame, _id: frame._id, name: frame.name as string, ref: frame.ref as string, image: await readMedia(frame.ref, 12 * 1024 * 1024), timestampSeconds: frame.timestampSeconds as number, pose: frame.pose as FramePose })));
        const assessed = await analyzeFurnitureVideoFrames(images, (session?.nativeLive?.elements || []) as RoomElement[]);
        for (const { frame, result } of assessed) {
          await db.collection('liveEvidence').updateOne({ sessionId, observationId: `frame-${frame.name}` }, { $setOnInsert: { sessionId, observationId: `frame-${frame.name}`, ref: frame.ref, createdAt: new Date() } }, { upsert: true });
          for (const f of result.findings) {
            const previous = f.worldPosition && f.elementId ? await db.collection('liveFindings').find({ sessionId, damageType: f.damageType, elementId: f.elementId, worldPosition: { $exists: true }, reviewStatus: { $ne: 'rejected' } }).toArray() : [];
            if (previous.some(p => p.worldPosition && Math.hypot(...f.worldPosition!.map((n, i) => n - p.worldPosition[i])) < .12)) continue;
            // Frame id + index also prevents a retry from duplicating this same observation.
            const id = `${frame._id}-${result.findings.indexOf(f)}`;
            await db.collection('liveFindings').updateOne({ sessionId, id }, { $setOnInsert: { ...f, id, sessionId, kind: 'damage', source: 'ai', frameName: frame.name, evidenceFrameRef: frame.ref, timestampSeconds: frame.timestampSeconds, pose: frame.pose, createdAt: new Date(), reviewHistory: [] } }, { upsert: true });
          }
          await frames.updateOne({ _id: frame._id }, { $set: { status: 'done', views: result.views, findings: result.findings.length, warnings: result.warnings, finishedAt: new Date() } });
        }
      } catch (error) {
        const failure = analysisFailure(error);
        await frames.updateMany({ _id: { $in: batch.map(f => f._id) }, status: 'analyzing' }, { $set: { status: 'failed', error: failure.message, errorCode: failure.code, finishedAt: new Date() } });
        await sessions.updateOne({ _id: sessionId }, { $set: { analysisIssue: { ...failure, at: new Date().toISOString() } } });
        if (failure.blocksService) break;
      }
    }
  } finally {
    await sessions.updateOne({ _id: sessionId, 'furnitureWorker.lease': lease }, { $unset: { furnitureWorker: '' } });
  }
}

function ownerFor(f: { elementId?: string | null; worldPosition?: number[] | null }, elements: SpatialElement[]) {
  if (f.elementId && elements.some(e => e.id === f.elementId)) return f.elementId;
  if (!f.worldPosition) return null;
  const pos = f.worldPosition as [number, number, number];
  return elements.filter(e => insideElement(pos, e, .12)).sort((a, b) => a.dimensions.reduce((x, y) => x * Math.max(y, .02), 1) - b.dimensions.reduce((x, y) => x * Math.max(y, .02), 1))[0]?.id ?? null;
}

/**
 * Saved LiDAR scan. Every evidence photo is analysed against the final measured room: photos already
 * done during the scan reuse their findings without further model calls, the rest are analysed now. Each piece of
 * furniture gets its best photo as an "object" finding so the room page can show where it was seen.
 */
export async function analyzeNativeInspection(inspection: Document, manifest: SpatialManifest, sessionId: ObjectId | null, options: { objectElementIds?: string[] } = {}) {
  const db = await getDb(), warnings: string[] = ["Photos and LiDAR geometry do not cover every surface. Damage checks inspect obvious damage on visible basic furniture only."];
  const deadline = Date.now() + 240_000;
  try {
    await db.collection("inspections").updateOne({ _id: inspection._id }, { $set: { status: "processing" } });
    const elements = manifest.elements, base = { ownerId: inspection.ownerId, inspectionId: inspection._id, roomId: inspection.roomId };
    const imageRef = (name: string) => manifest.assets.find(a => a.name === name && a.kind === "image")?.mediaRef;
    /** LiDAR depth and confidence for this photo, when the phone kept them, for the crack edge check. */
    const depthFor = async (fr: { depth?: string; confidence?: string; depthWidth?: number; depthHeight?: number }): Promise<DepthPatch | null> => {
      const d = fr.depth && manifest.assets.find(a => a.name === fr.depth && a.kind === "depth")?.mediaRef, c = fr.confidence && manifest.assets.find(a => a.name === fr.confidence && a.kind === "confidence")?.mediaRef;
      const w = fr.depthWidth, h = fr.depthHeight;
      if (!d || !w || !h) return null;
      const raw = await readMedia(d, 4 * w * h + 16);
      if (raw.length < 4 * w * h) return null;
      const data = new Float32Array(w * h); for (let i = 0; i < w * h; i++) data[i] = raw.readFloatLE(i * 4);
      const conf = c ? await readMedia(c, w * h + 16).catch(() => null) : null;
      return { data, width: w, height: h, confidence: conf && conf.length >= w * h ? new Uint8Array(conf.subarray(0, w * h)) : undefined };
    };
    // Let in-flight live results finish before taking the saved snapshot. Workers stop claiming on save.
    if (sessionId) {
      const waitUntil = Date.now() + 95_000;
      while (Date.now() < waitUntil && await db.collection('liveFrames').countDocuments({sessionId,status:'analyzing'})) await new Promise(resolve => setTimeout(resolve, 500));
    }
    const liveFrames = sessionId ? await db.collection("liveFrames").find({ sessionId, status: "done" }).toArray() : [];
    const liveFindings = sessionId ? await db.collection("liveFindings").find({ sessionId, source: "ai", frameName: { $in: liveFrames.map(f => f.name) } }).toArray() : [];
    const collected: (FrameFinding & { ref: string; timestampSeconds: number; liveId?: string })[] = [];
    // Reuse what the scan already found.
    for (const f of liveFindings) if (f.reviewStatus !== "rejected") {
      // RoomPlan may not have recognized this furniture when the live photo was first checked.
      // Reproject using THAT photo's calibrated pose against the final room, without another AI call.
      const located = f.pose ? localizeDamageBox(f.boundingBox, f.pose, elements as RoomElement[], true) : null;
      collected.push({ ...(f as unknown as FrameFinding), ...(located ? { elementId: located.owner?.id ?? null, elementCategory: located.owner?.category ?? 'unassigned', worldPosition: located.worldPosition } : {}), ref: f.evidenceFrameRef, timestampSeconds: f.timestampSeconds, liveId: f.id, reviewStatus: f.reviewStatus });
    }
    // Check all remaining evidence in timestamped batches, rather than running separate calls per crop.
    const sampled = oneFramePerSecond(manifest.frames.map(fr => ({ ...fr, timestampSeconds: fr.timestamp })));
    const todo = sampled.filter(fr => !liveFrames.some(l => l.ref === imageRef(fr.image) || Math.floor(l.timestampSeconds) === Math.floor(fr.timestamp)) && imageRef(fr.image));
    let blocked = sessionId ? (await db.collection('liveSessions').findOne({ _id: sessionId }))?.analysisIssue : null;
    if (!blocked?.blocksService) blocked = null;
    if (blocked) warnings.push(blocked.message);
    warnings.push(...liveFrames.flatMap(f => f.warnings || []));
    let analysed = liveFrames.length, skipped = 0, cursor = 0;
    const worker = async () => {
      while (cursor < todo.length) {
        const batch = todo.slice(cursor, cursor += 6);
        if (blocked || Date.now() > deadline - 65_000) {
          skipped += batch.length;
          if (sessionId) await db.collection('liveFrames').updateMany({sessionId,name:{$in:batch.map(fr=>fr.image)},status:'queued'},{$set:{status:'failed',error:blocked?.message || 'Analysis time budget reached. Photo retained.'}});
          continue;
        }
        try {
          const images = await Promise.all(batch.map(async fr => ({ image: await readMedia(imageRef(fr.image)!, 12 * 1024 * 1024), timestampSeconds: fr.timestamp, fr })));
          const assessed = await analyzeFurnitureVideoFrames(await Promise.all(images.map(async f => ({ ...f, pose: f.fr, depth: await depthFor(f.fr).catch(() => null) }))), elements as RoomElement[]);
          for (const { frame: { fr }, result } of assessed) {
            result.findings.forEach(f => collected.push({ ...f, ref: imageRef(fr.image)!, timestampSeconds: fr.timestamp })); analysed++;
            warnings.push(...result.warnings);
            if (sessionId) await db.collection('liveFrames').updateOne({sessionId,name:fr.image},{$set:{status:'done',ref:imageRef(fr.image),timestampSeconds:fr.timestamp,finishedAt:new Date(),warnings:result.warnings}},{upsert:true});
          }
        } catch (error) {
          const failure = analysisFailure(error);
          if (failure.blocksService) blocked = failure;
          warnings.push(failure.message);
          if (sessionId) await db.collection('liveFrames').updateMany({sessionId,name:{$in:batch.map(fr=>fr.image)},status:{$ne:'done'}},{$set:{status:'failed',error:'Saved damage check failed. Photo retained.'}});
          warnings.push(`Photos at ${batch[0].timestamp.toFixed(1)}s–${batch[batch.length - 1].timestamp.toFixed(1)}s could not be analysed.`); }
      }
    };
    await worker();
    if (skipped) warnings.push(`${skipped} photos were not analysed because analysis was unavailable or its time budget ran out.`);
    // Repeated views of the same measured mark are a single finding, not new damage each second.
    const unique: typeof collected = [];
    for (const f of collected) {
      if (f.worldPosition && f.elementId && unique.some(p => p.worldPosition && p.elementId === f.elementId && p.damageType === f.damageType && Math.hypot(...f.worldPosition!.map((n, i) => n - p.worldPosition![i])) < .12)) continue;
      unique.push(f);
    }
    // Damage findings and their 3D markers.
    for (const f of unique) {
      const id = new ObjectId(), elementId = ownerFor(f, elements);
      await db.collection("findings").insertOne({ ...base, _id: id, kind: "damage", label: f.label, description: f.description, damageType: f.damageType, evidenceFrameUrl: f.ref, boundingBox: f.boundingBox, timestampSeconds: f.timestampSeconds, source: "ai", detectionSource: f.detectionSource, spatialElementId: elementId, reviewStatus: f.reviewStatus, autoApproved: !!f.autoApproved, ...(f.confidence != null ? { confidence: f.confidence } : {}), ...(f.verification ? { verification: { ...f.verification, model: process.env.GEMINI_VERIFY_MODEL || process.env.GEMINI_MODEL || "gemini-4-argon", at: new Date() } } : {}), reviewHistory: f.autoApproved ? [{ from: "pending", to: "confirmed", at: new Date(), by: "auto-verifier", confidence: f.verification?.confidence }] : [], ...(f.liveId ? { liveFindingId: f.liveId } : {}), createdAt: new Date() });
      if (f.worldPosition) await db.collection("spatialMarkers").insertOne({ ...base, sessionId: manifest.sessionId, findingId: String(id), position: f.worldPosition, label: f.description || f.label, elementId, reviewStatus: f.reviewStatus, version: 1, source: "photo-projection", createdAt: new Date(), reviewHistory: [{ action: "projected", at: new Date() }] });
    }
    // Where each piece of furniture was seen best.
    const furniture = elements.filter(isFurniture), names = furnitureNames(furniture);
    // A continued scan only adds views for furniture it newly measured.
    for (const e of furniture.filter(e => !options.objectElementIds || options.objectElementIds.includes(e.id))) {
      let best: { box: { x: number; y: number; width: number; height: number }; area: number; ref: string; t: number } | null = null;
      for (const fr of manifest.frames) { const ref = imageRef(fr.image); if (!ref) continue; const v = elementInView(e as RoomElement, fr as FramePose); if (v && (!best || v.area > best.area)) best = { box: v.box, area: v.area, ref, t: fr.timestamp }; }
      if (best) await db.collection("findings").insertOne({ ...base, kind: "object", label: names.get(e.id) || e.category, description: `Measured ${e.dimensions.map(n => Number(n).toFixed(2)).join(" × ")} m from this scan.`, dimensions: e.dimensions, spatialElementId: e.id, evidenceFrameUrl: best.ref, boundingBox: best.box, timestampSeconds: best.t, source: "ai", detectionSource: "roomplan", reviewStatus: "confirmed", reviewHistory: [], createdAt: new Date() });
    }
    await prepareObjectReconstructions(inspection, manifest).catch(() => {});
    const approved = collected.filter(f => f.autoApproved).length;
    await db.collection("inspections").updateOne({ _id: inspection._id }, { $set: { status: skipped || warnings.length > 1 ? "partial" : "completed", analysisWarnings: [...new Set(warnings)], autoReview: { checked: collected.filter(f => f.verification).length, approved }, framesAnalysed: analysed, completedAt: new Date(), durationSeconds: manifest.frames.at(-1)?.timestamp || 0 } });
    await indexFindings(inspection.ownerId, inspection._id).catch(() => {});
  } catch {
    await db.collection("inspections").updateOne({ _id: inspection._id }, { $set: { status: "partial", analysisWarnings: [...warnings, "Analysis did not finish. The capture is preserved."] } });
  }
}
