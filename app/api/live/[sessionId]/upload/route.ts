import {authenticateLive,liveCollections,liveFailure,LiveError} from "@/lib/server/live-sessions";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Binary, ObjectId, type Db } from "mongodb";
import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";
import { deleteMedia, writeMedia } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const CHUNK_SIZE = 2 * 1024 * 1024;
const MAX_BYTES = 100 * 1024 * 1024;
const TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg", "image/jpeg", "application/octet-stream", "model/vnd.usdz+zip"];
type Upload = { sessionId: ObjectId; _id: ObjectId; filename: string; contentType: string; size: number; expiresAt: Date; status: "uploading" | "finalizing" | "complete"; lockId?: string; lockedAt?: Date; url?: string };
type Part = { uploadId: ObjectId; part: number; data: Binary; digest: string; size: number; expiresAt: Date };
const indexTasks = new WeakMap<Db, Promise<unknown>>();
async function collections() {
  const db = await getDb();
  const uploads = db.collection<Upload>("liveUploads");
  const parts = db.collection<Part>("liveUploadParts");
  let ready = indexTasks.get(db);
  if (!ready) {
    ready = Promise.all([
      uploads.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      parts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      parts.createIndex({ uploadId: 1, part: 1 }, { unique: true }),
    ]).catch(error => { indexTasks.delete(db); throw error; });
    indexTasks.set(db, ready);
  }
  await ready;
  return { uploads, parts };
}
const failure = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(request: Request, {params}:{params:Promise<{sessionId:string}>}) {
  let cleanupRef: string | undefined;
  let finalizeHeartbeat: ReturnType<typeof setInterval> | undefined;
  let unlock: (() => Promise<unknown>) | undefined;
  try {
    const {sessionId}=await params; const {session}=await authenticateLive(request,sessionId,"phone");
    if(session.status==="saved")throw new LiveError("Inspection is already saved",409);
    const body = await request.json();
    const { uploads, parts } = await collections();
    if (body.action === "complete") {
      const id = typeof body.uploadId === "string" ? parseObjectId(body.uploadId) : null;
      if (!id) return failure("Invalid upload ID");
      const existing = await uploads.findOne({ _id: id, sessionId: session._id, expiresAt: { $gt: new Date() } });
      if (!existing) return failure("Upload not found or expired", 404);
      if (existing.status === "complete") {const {sessions}=await liveCollections();if(existing.contentType.startsWith("video/"))await sessions.updateOne({_id:session._id},{$set:{sourceUrl:existing.url,videoMimeType:existing.contentType}});return NextResponse.json({ url: existing.url, videoUrl: existing.url, contentType: existing.contentType });}
      const lockId = randomUUID();
      // Recover a finalization abandoned by a terminated function after its maximum duration.
      const upload = await uploads.findOneAndUpdate({ _id: id, $or: [{ status: "uploading" }, { status: "finalizing", lockedAt: { $lt: new Date(Date.now() - 60_000) } }] }, { $set: { status: "finalizing", lockId, lockedAt: new Date() } }, { returnDocument: "after" });
      if (!upload) return failure("Upload is being finalized; retry shortly", 409);
      // Renew the lease while work is alive; a terminated function becomes recoverable in one minute.
      finalizeHeartbeat=setInterval(()=>{void uploads.updateOne({_id:id,lockId,status:'finalizing'},{$set:{lockedAt:new Date()}}).catch(()=>{});},15_000);
      unlock = () => uploads.updateOne({ _id: id, lockId }, { $set: { status: "uploading" }, $unset: { lockId: "", lockedAt: "" } });
      const count = Math.ceil(upload.size / CHUNK_SIZE);
      const descriptors = await parts.find({ uploadId: id }, { projection: { part: 1, size: 1 } }).sort({ part: 1 }).toArray();
      if (descriptors.length !== count || descriptors.some((part, i) => part.part !== i || part.size !== Math.min(CHUNK_SIZE, upload.size - i * CHUNK_SIZE))) {
        await unlock(); unlock = undefined;
        return failure("Upload is incomplete", 409);
      }
      async function* chunks() {
        let bytes = 0;
        let index = 0;
        const cursor = parts.find({ uploadId: id! }).sort({ part: 1 }).batchSize(2);
        try {
        for await (const part of cursor) {
          if (part.part !== index++) throw new Error("Missing or unordered upload part");
          const data = Buffer.from(part.data.buffer);
          bytes += data.length;
          if (data.length !== part.size || bytes > upload!.size || createHash("sha256").update(data).digest("hex") !== part.digest) throw new Error("Invalid upload part");
          yield data;
        }
        if (bytes !== upload!.size || index !== count) throw new Error("Invalid upload length");
        } finally { await cursor.close(); }
      }
      cleanupRef = await writeMedia(Readable.from(chunks()), upload.filename, upload.contentType, {ownerId:session.ownerId,liveSessionId:String(session._id)});
      const result = await uploads.updateOne({ _id: id, lockId }, { $set: { status: "complete", url: cleanupRef }, $unset: { lockId: "", lockedAt: "" } });
      if (!result.modifiedCount) throw new Error("Upload finalization expired");
      const url = cleanupRef; cleanupRef = undefined; unlock = undefined;
      await parts.deleteMany({ uploadId: id });
      const {sessions}=await liveCollections(); if(upload.contentType.startsWith("video/"))await sessions.updateOne({_id:session._id},{$set:{sourceUrl:url,videoMimeType:upload.contentType}});
      return NextResponse.json({ url, videoUrl: url, contentType: upload.contentType }, { status: 201 });
    }
    const contentType = typeof body.contentType === "string" ? body.contentType.split(";")[0].trim().toLowerCase() : "";
    if (!TYPES.includes(contentType)) return failure("Unsupported video format", 415);
    if (!Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_BYTES) return failure("Video size must be between 1 byte and 100 MB", 413);
    const filename = String(body.filename || "walkthrough-video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
    const upload: Upload = { sessionId:session._id, _id: new ObjectId(), filename, contentType, size: body.size, status: "uploading", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
    await uploads.insertOne(upload);
    return NextResponse.json({ uploadId: upload._id.toHexString(), chunkSize: CHUNK_SIZE }, { status: 201 });
  } catch (error) {
    if (cleanupRef) await deleteMedia(cleanupRef).catch(() => {});
    if (unlock) await unlock().catch(() => {});
    return liveFailure(error);
  } finally {if(finalizeHeartbeat)clearInterval(finalizeHeartbeat);}
}

export async function PATCH(request: Request, {params}:{params:Promise<{sessionId:string}>}) {
  try {
    const {sessionId}=await params; const {session}=await authenticateLive(request,sessionId,"phone");
    if(session.status==="saved")throw new LiveError("Inspection is already saved",409);
    const url = new URL(request.url);
    const id = parseObjectId(url.searchParams.get("uploadId") || "");
    const partText = url.searchParams.get("part") || "";
    const part = /^\d+$/.test(partText) ? Number(partText) : NaN;
    if (!id || !Number.isSafeInteger(part) || part < 0) return failure("Invalid upload part");
    const { uploads, parts } = await collections();
    const upload = await uploads.findOne({ _id: id, sessionId: session._id, expiresAt: { $gt: new Date() } });
    if (!upload) return failure("Upload not found or expired", 404);
    if (upload.status !== "uploading") return failure("Upload is no longer accepting parts", 409);
    const expected = Math.min(CHUNK_SIZE, upload.size - part * CHUNK_SIZE);
    if (expected <= 0) return failure("Invalid upload part");
    if (!request.body) return failure("Missing upload data");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > expected) { await reader.cancel(); return failure("Upload part exceeds its expected size", 413); }
      chunks.push(item.value);
    }
    if (size !== expected) return failure("Upload part has an incorrect size");
    const data = Buffer.concat(chunks);
    const digest = createHash("sha256").update(data).digest("hex");
    // Parts are independent: concurrent requests may finish in any order.
    // Completion validates the full sequence, sizes and hashes before publishing media.
    // Insert-only makes retries idempotent and prevents replacing data during finalization.
    await parts.updateOne({ uploadId: id, part }, { $setOnInsert: { uploadId: id, part, data: new Binary(data), digest, size, expiresAt: upload.expiresAt } }, { upsert: true });
    const stored = await parts.findOne({ uploadId: id, part }, { projection: { digest: 1 } });
    if (stored?.digest !== digest) return failure("Upload part differs from the previously accepted data", 409);
    return NextResponse.json({ part, received: size });
  } catch (error) { return liveFailure(error); }
}

export async function GET(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {session}=await authenticateLive(request,(await params).sessionId,"phone");
 const id=parseObjectId(new URL(request.url).searchParams.get('uploadId')||'');if(!id)return failure('Invalid upload ID');
 const {uploads,parts}=await collections();const upload=await uploads.findOne({_id:id,sessionId:session._id,expiresAt:{$gt:new Date()}});if(!upload)return failure('Upload not found or expired',404);
 if(upload.status==='finalizing'&&upload.lockedAt&&upload.lockedAt.getTime()<Date.now()-60_000){
  const recovered=await uploads.updateOne({_id:id,lockId:upload.lockId,status:'finalizing',lockedAt:{$lt:new Date(Date.now()-60_000)}},{$set:{status:'uploading'},$unset:{lockId:'',lockedAt:''}});
  if(recovered.modifiedCount)upload.status='uploading';
 }
 const received=upload.status==='uploading'?await parts.find({uploadId:id},{projection:{part:1}}).sort({part:1}).toArray():[];
 return NextResponse.json({status:upload.status,url:upload.status==='complete'?upload.url:undefined,contentType:upload.contentType,parts:received.map(part=>part.part)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return liveFailure(error);}}
