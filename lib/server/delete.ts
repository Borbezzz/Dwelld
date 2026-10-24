import { ObjectId, type Document } from "mongodb";
import { getDb } from "./db";
import { deleteMedia } from "./media";

const REF = /^gridfs:[a-f0-9]{24}$/;
/** Every GridFS reference anywhere inside these documents. */
function collectRefs(value: unknown, into: Set<string>) {
  if (typeof value === "string") { if (REF.test(value)) into.add(value); return; }
  if (Array.isArray(value)) { value.forEach(v => collectRefs(v, into)); return; }
  if (value && typeof value === "object" && !(value instanceof ObjectId) && !(value instanceof Date)) Object.values(value as Document).forEach(v => collectRefs(v, into));
}

/**
 * Permanently removes one inspection and everything that belongs only to it:
 * findings, 3D capture, markers, live-session records, comparisons that used it,
 * and the stored photos, video and 3D files. Media of other inspections is never touched.
 */
export async function deleteInspection(inspection: Document) {
  const db = await getDb(), id = inspection._id as ObjectId, refs = new Set<string>();
  const [findings, captures, markers, sessions, comparisons] = await Promise.all([
    db.collection("findings").find({ inspectionId: id }).toArray(),
    db.collection("spatialCaptures").find({ inspectionId: id }).toArray(),
    db.collection("spatialMarkers").find({ inspectionId: id }).toArray(),
    db.collection("liveSessions").find({ $or: [{ inspectionId: id }, { _id: id }] }).toArray(),
    db.collection("comparisons").find({ $or: [{ baselineInspectionId: id }, { currentInspectionId: id }] }).toArray(),
  ]);
  const sessionIds = sessions.map(s => s._id);
  const live = sessionIds.length ? await Promise.all(["liveEvidence", "liveFindings", "liveAnalyses"].map(c => db.collection(c).find({ sessionId: { $in: sessionIds } }).toArray())) : [];
  collectRefs([inspection, findings, captures, markers, sessions, live], refs);
  // A comparison borrows the other scan's evidence; only frames it generated itself are removed.
  comparisons.forEach(c => (c.generatedRefs as string[] | undefined)?.forEach(r => REF.test(r) && refs.add(r)));
  await Promise.all([
    db.collection("findings").deleteMany({ inspectionId: id }),
    db.collection("spatialCaptures").deleteMany({ inspectionId: id }),
    db.collection("spatialMarkers").deleteMany({ inspectionId: id }),
    db.collection("objectReconstructions").deleteMany({ inspectionId: id }),
    db.collection("inspectionReports").deleteMany({ inspectionId: id }),
    db.collection("comparisons").deleteMany({ _id: { $in: comparisons.map(c => c._id) } }),
    db.collection("observationCorrespondences").deleteMany({ $or: [{ baselineInspectionId: id }, { currentInspectionId: id }, { comparisonId: { $in: comparisons.map(c => c._id) } }] }),
    ...(sessionIds.length ? ["liveEvidence", "liveFindings", "liveAnalyses", "liveObjects", "liveEvents", "liveSignals", "liveStream", "liveFrames"].map(c => db.collection(c).deleteMany({ sessionId: { $in: sessionIds } })) : []),
    db.collection("liveSessions").deleteMany({ _id: { $in: sessionIds } }),
  ]);
  await db.collection("inspections").deleteOne({ _id: id, ownerId: inspection.ownerId });
  // Files last: if this stops part-way the records are already gone, never the other way round.
  await Promise.allSettled([...refs].map(async ref => {
    // A saved-video retry owns new evidence but shares the original source video.
    if (await db.collection("inspections").findOne({ sourceUrl:ref }, {projection:{_id:1}})) return;
    await deleteMedia(ref);
  }));
  return { deletedFiles: refs.size };
}

export async function deleteRoom(room: Document) {
  const db = await getDb();
  const inspections = await db.collection("inspections").find({ roomId: room._id, ownerId: room.ownerId }).toArray();
  for (const inspection of inspections) await deleteInspection(inspection);
  await db.collection("rooms").deleteOne({ _id: room._id, ownerId: room.ownerId });
  return { deletedInspections: inspections.length };
}
