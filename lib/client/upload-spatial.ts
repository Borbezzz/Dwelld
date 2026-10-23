/** Chunked authenticated upload into the same GridFS media service used by videos. */
export async function uploadSpatial(file: File, contentType: string): Promise<string> {
  if (!file.size || file.size > 100 * 1024 * 1024) throw new Error("Each spatial asset must be between 1 byte and 100 MB.");
  async function read(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Spatial upload failed"); return body; }
  const init = await read(await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType, size: file.size }) }));
  for (let offset = 0, part = 0; offset < file.size; offset += init.chunkSize, part++) await read(await fetch(`/api/uploads?uploadId=${encodeURIComponent(init.uploadId)}&part=${part}`, { method: "PATCH", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(offset, offset + init.chunkSize) }));
  const complete = await read(await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete", uploadId: init.uploadId }) }));
  if (!/^gridfs:[a-f0-9]{24}$/.test(complete.url)) throw new Error("Invalid stored asset reference");
  return complete.url;
}
