import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VIDEO_TYPES = ["video/*"];
const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Video upload is unavailable: BLOB_READ_WRITE_TOKEN is not configured" }, { status: 503 });
  }
  try {
    // Preferred flow: @vercel/blob/client upload() exchanges an upload token,
    // and the browser streams the private video directly to Blob storage.
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json() as HandleUploadBody;
      const result = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: VIDEO_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        }),
        onUploadCompleted: async () => {},
      });
      return NextResponse.json(result);
    }

    // Small local-development fallback. Large production videos should use the
    // direct client upload protocol above so they do not transit a function.
    const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"].includes(type)) return NextResponse.json({ error: "Unsupported video format" }, { status: 415 });
    const filename = decodeURIComponent(request.headers.get("x-file-name") || "walkthrough-video");
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BYTES) return NextResponse.json({ error: "Video exceeds the 100 MB upload limit" }, { status: 413 });
    if (!request.body) return NextResponse.json({ error: "No video was uploaded" }, { status: 400 });
    const blob = await put("inspections/" + Date.now() + "-" + safeName, request.body, {
      access: "private", contentType: type, addRandomSuffix: true, allowOverwrite: false,
    });
    return NextResponse.json({ videoUrl: blob.url, url: blob.url, contentType: type }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload video";
    return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid request body" : "The service could not complete this request. Check server configuration and try again." }, { status: 400 });
  }
}
