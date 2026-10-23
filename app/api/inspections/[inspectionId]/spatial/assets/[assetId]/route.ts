import { requireUser, requireOwnedInspection } from "@/lib/server/access";
import { getDb } from "@/lib/server/db";
import { mediaResponse } from "@/lib/server/media";
import { errorResponse } from "@/lib/server/api-error";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ inspectionId: string; assetId: string }> }) {
  try {
    const user = await requireUser(request), { inspectionId, assetId } = await params;
    const inspection = await requireOwnedInspection(inspectionId, user.id);
    const capture = await (await getDb()).collection("spatialCaptures").findOne({ inspectionId: inspection._id });
    const asset = capture?.manifest.assets.find((a: { name: string }) => a.name === assetId);
    if (!asset) return new Response("Not found", { status: 404 });
    return mediaResponse(asset.mediaRef, request);
  } catch (e) { return errorResponse(e, "spatial.asset"); }
}
