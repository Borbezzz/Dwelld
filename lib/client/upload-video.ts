import {uploadChunks} from "./upload-chunks";
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

type StoredVideo = { url: string; contentType: string };
type UploadOptions = { signal?: AbortSignal; onProgress?: (percentage: number) => void };

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Video upload failed. Please try again.");
  }
  if (!body) throw new Error("The upload service returned an invalid response.");
  return body;
}

/** Keep each request below the hosting request-body limit; media is stored in MongoDB GridFS. */
export async function uploadVideo(file: File, { signal, onProgress }: UploadOptions = {}): Promise<StoredVideo> {
  if (!file.size || !file.type.startsWith("video/")) throw new Error("Choose a non-empty video file.");
  if (file.size > MAX_VIDEO_BYTES) throw new Error("Choose a video smaller than 100 MB.");
  signal?.throwIfAborted();
  onProgress?.(0);
  const contentType = file.type.split(";")[0];
  const initialized = await readResponse(await fetch("/api/uploads", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType, size: file.size }),
  }));
  if (typeof initialized.uploadId !== "string") throw new Error("The upload service did not create an upload.");
  const uploadId = initialized.uploadId;
  await uploadChunks(file,UPLOAD_CHUNK_BYTES,async(part,chunk)=>{
    signal?.throwIfAborted();
    return readResponse(await fetch(`/api/uploads?uploadId=${encodeURIComponent(uploadId)}&part=${part}`,{method:"PATCH",signal,headers:{"Content-Type":"application/octet-stream"},body:chunk}));
  },onProgress);
  signal?.throwIfAborted();
  const completed = await readResponse(await fetch("/api/uploads", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete", uploadId }),
  }));
  if (typeof completed.url !== "string" || !/^gridfs:[a-f\d]{24}$/i.test(completed.url)) {
    throw new Error("The upload service did not return a saved video.");
  }
  onProgress?.(100);
  return { url: completed.url, contentType: typeof completed.contentType === "string" ? completed.contentType : contentType };
}
