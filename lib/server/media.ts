import { GridFSBucket, ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getDb, parseObjectId } from "./db";

const BUCKET = "media";
export function parseMediaId(ref: string): ObjectId | null {
  return typeof ref === "string" && ref.startsWith("gridfs:") ? parseObjectId(ref.slice(7)) : null;
}
async function bucket() { return new GridFSBucket(await getDb(), { bucketName: BUCKET }); }
export async function writeMedia(source: Buffer | Readable, filename: string, contentType: string): Promise<string> {
  const store = await bucket();
  const stream = store.openUploadStream(filename, { metadata: { contentType }, chunkSizeBytes: 255 * 1024 });
  try {
    await pipeline(Buffer.isBuffer(source) ? Readable.from([source]) : source, stream);
    return `gridfs:${stream.id.toHexString()}`;
  } catch (error) {
    await stream.abort().catch(() => {});
    await store.delete(stream.id).catch(() => {});
    throw error;
  }
}
export async function getMediaFile(ref: string) {
  const id = parseMediaId(ref);
  if (!id) throw new Error("Invalid media reference");
  return (await bucket()).find({ _id: id }).next();
}
export async function readMedia(ref: string, maxBytes: number): Promise<Buffer> {
  const file = await getMediaFile(ref);
  if (!file) throw new Error("Media not found");
  if (file.length > maxBytes) throw new Error("Media exceeds the size limit");
  const stream = (await bucket()).openDownloadStream(file._id);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) throw new Error("Media exceeds the size limit");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally { stream.destroy(); }
}
export async function deleteMedia(ref: string): Promise<void> {
  const id = parseMediaId(ref);
  if (!id) throw new Error("Invalid media reference");
  const store = await bucket();
  if (await store.find({ _id: id }).next()) await store.delete(id);
}
/** Streams private media through the app, including single HTTP byte ranges. */
export async function mediaResponse(ref: string, request: Request): Promise<Response> {
  const file = await getMediaFile(ref);
  if (!file) return new Response("Media not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": String(file.metadata?.contentType || "application/octet-stream"),
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  let start = 0;
  let end = file.length - 1;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = () => new Response(null, { status: 416, headers: { ...Object.fromEntries(headers), "Content-Range": `bytes */${file.length}` } });
    if (!match || (!match[1] && !match[2]) || file.length === 0) return invalid();
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid();
      start = Math.max(0, file.length - suffix);
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.length) return invalid();
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${file.length}`);
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (request.method === "HEAD" || file.length === 0) return new Response(null, { status: range ? 206 : 200, headers });
  const stream = (await bucket()).openDownloadStream(file._id, { start, end: end + 1 });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
