import { createHash } from "node:crypto";
import { GridFSBucket, ObjectId, type Document } from "mongodb";
import { getDb, parseObjectId } from "./db";
import { buildEntry, chainProblems, entryProblems, filesRoot, GENESIS, ledgerKeys, type LedgerEntry, type SealedFile } from "./ledger-core";

const LEDGER = "evidenceLedger";
const keys = () => ledgerKeys(process.env.LEDGER_SECRET || process.env.BETTER_AUTH_SECRET || "");
export const ledgerPublicKey = () => { const k = keys(); return { publicKey: k.publicKeyBase64, keyId: k.keyId, algorithm: "Ed25519" }; };

/** Streams a GridFS file through SHA-256 without holding it in memory. */
async function hashMedia(bucket: GridFSBucket, ref: string): Promise<{ sha256: string; bytes: number } | null> {
  const id = ref.startsWith("gridfs:") ? parseObjectId(ref.slice(7)) : null;
  if (!id) return null;
  const file = await bucket.find({ _id: id }).next();
  if (!file) return null;
  const hash = createHash("sha256");
  for await (const chunk of bucket.openDownloadStream(id)) hash.update(chunk as Buffer);
  return { sha256: hash.digest("hex"), bytes: file.length };
}

/** Every stored file that is evidence for this inspection: scan photos, depth, 3D, video and marked photos. */
async function evidenceRefs(inspectionId: ObjectId) {
  const db = await getDb(), refs = new Map<string, { name: string; kind: string }>();
  const add = (ref: unknown, name: string, kind: string) => { if (typeof ref === "string" && ref.startsWith("gridfs:") && !refs.has(ref)) refs.set(ref, { name, kind }); };
  const [inspection, capture, findings] = await Promise.all([
    db.collection("inspections").findOne({ _id: inspectionId }, { projection: { sourceUrl: 1, evidenceFrames: 1 } }),
    db.collection("spatialCaptures").findOne({ inspectionId }, { projection: { "manifest.assets": 1 } }),
    db.collection("findings").find({ inspectionId, evidenceFrameUrl: { $type: "string" } }, { projection: { evidenceFrameUrl: 1, label: 1 } }).toArray(),
  ]);
  add(inspection?.sourceUrl, "walkthrough video", "video");
  for (const f of (inspection?.evidenceFrames || []) as { url?: string; timestampSeconds?: number }[]) add(f.url, `frame ${f.timestampSeconds ?? ""}`.trim(), "image");
  for (const a of (capture?.manifest?.assets || []) as { name: string; mediaRef: string; kind: string }[]) add(a.mediaRef, a.name, a.kind);
  for (const f of findings) add(f.evidenceFrameUrl, String(f.label || "finding photo"), "image");
  return refs;
}

async function hashAll(refs: Map<string, { name: string; kind: string }>) {
  const bucket = new GridFSBucket(await getDb(), { bucketName: "media" }), list = [...refs], files: SealedFile[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, list.length) }, async () => {
    while (cursor < list.length) {
      const [ref, meta] = list[cursor++], h = await hashMedia(bucket, ref);
      if (h) files.push({ ref, name: meta.name.slice(0, 120), kind: meta.kind, ...h });
    }
  }));
  return files.sort((a, b) => a.ref.localeCompare(b.ref));
}

/**
 * Seals the inspection's current evidence into the ledger. A later seal is added only when the
 * evidence has grown (a continued scan, marked photos); an unchanged inspection is not re-sealed.
 */
export async function sealInspection(inspectionId: ObjectId) {
  const db = await getDb(), ledger = db.collection<LedgerEntry & { _id?: ObjectId; ownerId: string }>(LEDGER);
  await ledger.createIndex({ seq: 1 }, { unique: true });
  await ledger.createIndex({ inspectionId: 1, seq: -1 });
  const inspection = await db.collection("inspections").findOne({ _id: inspectionId }, { projection: { ownerId: 1, roomId: 1 } });
  if (!inspection) throw new Error("Inspection not found");
  const files = await hashAll(await evidenceRefs(inspectionId));
  if (!files.length) return null;
  const k = keys(), id = String(inspectionId);
  const latest = await ledger.findOne({ inspectionId: id }, { sort: { seq: -1 } });
  if (latest && filesRoot(files) === latest.filesRoot) return latest;
  for (let attempt = 0; attempt < 6; attempt++) {
    const last = await ledger.findOne({}, { sort: { seq: -1 }, projection: { seq: 1, seal: 1 } });
    const entry = buildEntry({ seq: (last?.seq || 0) + 1, inspectionId: id, roomId: String(inspection.roomId), sealedAt: new Date().toISOString(), files, prevSeal: last?.seal || GENESIS }, k);
    try { await ledger.insertOne({ ...entry, ownerId: String(inspection.ownerId) }); return entry; }
    catch (e) { if ((e as { code?: number }).code !== 11000) throw e; } // another seal took this position: retry on top of it
  }
  throw new Error("Could not append to the evidence ledger");
}
export const sealLater = (inspectionId: ObjectId) => sealInspection(inspectionId).catch(e => console.error("evidence seal failed", e instanceof Error ? e.message : e));

/** Re-hashes the stored files now and checks each seal, its signature and the chain around it. */
export async function verifyInspection(inspectionId: ObjectId) {
  const db = await getDb(), ledger = db.collection<LedgerEntry & Document>(LEDGER), id = String(inspectionId), { publicKey, keyId } = ledgerPublicKey();
  const seals = await ledger.find({ inspectionId: id }, { projection: { _id: 0, ownerId: 0 } }).sort({ seq: 1 }).toArray();
  const chain = await ledger.find({}, { projection: { _id: 0, files: 0, ownerId: 0, signature: 0, keyId: 0 } }).sort({ seq: 1 }).limit(20000).toArray();
  const broken = chainProblems(chain as never);
  const latest = seals.at(-1), current = latest ? await hashAll(new Map(latest.files.map(f => [f.ref, { name: f.name, kind: f.kind }]))) : [];
  const now = new Map(current.map(f => [f.ref, f.sha256]));
  const changed = latest ? latest.files.filter(f => now.get(f.ref) !== f.sha256).map(f => ({ name: f.name, kind: f.kind, problem: now.has(f.ref) ? "changed since sealing" : "missing" })) : [];
  const entries = seals.map(s => ({ seq: s.seq, sealedAt: s.sealedAt, seal: s.seal, prevSeal: s.prevSeal, signature: s.signature, keyId: s.keyId, filesRoot: s.filesRoot, fileCount: s.files.length, problems: entryProblems(s as LedgerEntry, publicKey) }));
  const chainIssues = broken.slice(0, 20);
  return {
    sealed: !!latest, intact: !!latest && !changed.length && entries.every(e => !e.problems.length) && !broken.length,
    entries, changedFiles: changed.slice(0, 50), chain: { length: chain.length, intact: !broken.length, problems: chainIssues },
    publicKey, keyId, algorithm: "Ed25519", checkedAt: new Date().toISOString(),
  };
}
