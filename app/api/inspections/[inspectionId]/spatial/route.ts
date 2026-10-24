import {readJsonBody,readTextBody} from "@/lib/server/request-body";
import { NextResponse, after } from "next/server";
import { analyzeSpatialInspection } from "@/lib/server/spatial-analysis";
import { getDb } from "@/lib/server/db";
import { requireUser, requireOwnedInspection } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { getMediaFile } from "@/lib/server/media";
import { validateManifest, registration } from "@/lib/server/spatial";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ inspectionId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request), { inspectionId } = await params;
    const inspection = await requireOwnedInspection(inspectionId, user.id), db = await getDb();
    const [capture, markers] = await Promise.all([
      db.collection("spatialCaptures").findOne({ inspectionId: inspection._id }, { projection: { manifest: 1, createdAt: 1 } }),
      db.collection("spatialMarkers").find({ inspectionId: inspection._id, deletedAt: { $exists: false } }, { projection: { position: 1, label: 1, elementId: 1, findingId: 1, reviewStatus: 1, version: 1 } }).toArray(),
    ]);
    return NextResponse.json({ capture: capture ? { manifest: capture.manifest, createdAt: capture.createdAt } : null, markers: markers.map(m => ({ id: String(m._id), position: m.position, label: m.label, elementId: m.elementId, findingId: m.findingId || null, reviewStatus: m.reviewStatus, version: m.version })) });
  } catch (e) { return errorResponse(e, "spatial.read"); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request), { inspectionId } = await params;
    const inspection = await requireOwnedInspection(inspectionId, user.id), db = await getDb();
    const text = await readTextBody(request,2*1024*1024);
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) return NextResponse.json({ error: "Manifest exceeds 2 MB" }, { status: 413 });
    let manifest;
    try { manifest = validateManifest(JSON.parse(text)); } catch { return NextResponse.json({ error: "Invalid spatial capture manifest" }, { status: 400 }); }
    for (const asset of manifest.assets) if ((await getMediaFile(asset.mediaRef))?.metadata?.ownerId !== user.id) return NextResponse.json({ error: "Asset not owned by current account" }, { status: 403 });
    await db.collection("spatialCaptures").createIndex({ inspectionId: 1 }, { unique: true });
    // A scan origin is immutable once imported; replacing it would invalidate world-space markers.
    const existing = await db.collection("spatialCaptures").findOne({ inspectionId: inspection._id });
    if (existing && JSON.stringify(existing.manifest) === JSON.stringify(manifest)) return NextResponse.json({saved:true,alreadySaved:true});
    if (existing) return NextResponse.json({ error: "This inspection already has a capture. Use a new inspection for a different scan." }, { status: 409 });
    await db.collection("spatialCaptures").insertOne({ inspectionId: inspection._id, roomId: inspection.roomId, ownerId: user.id, manifest, createdAt: new Date() });
    if (inspection.captureSource === "native-lidar") {
      await db.collection("inspections").updateOne({ _id: inspection._id }, { $set: { status: "processing", analysisWarnings: ["Measured capture saved; image damage analysis is running."] } });
      after(() => analyzeSpatialInspection(inspection, manifest));
    }
    return NextResponse.json({ saved: true }, { status: 201 });
  } catch (e) { return errorResponse(e, "spatial.import"); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request), { inspectionId } = await params;
    const inspection = await requireOwnedInspection(inspectionId, user.id), db = await getDb();
    const b = await readJsonBody(request);
    if (typeof b.name !== "string" || !/^[a-zA-Z0-9_.-]{1,115}\.ply$/.test(b.name) || typeof b.mediaRef !== "string" || !/^gridfs:[a-f0-9]{24}$/.test(b.mediaRef)) return NextResponse.json({ error: "A Gaussian PLY asset is required" }, { status: 400 });
    if ((await getMediaFile(b.mediaRef))?.metadata?.ownerId !== user.id) return NextResponse.json({ error: "Asset not owned by current account" }, { status: 403 });
    const capture = await db.collection("spatialCaptures").findOne({ inspectionId: inspection._id });
    if (!capture) return NextResponse.json({ error: "Import a capture first" }, { status: 409 });
    let aligned;
    try { aligned = registration(b.registration, capture.manifest.sessionId); } catch { return NextResponse.json({ error: "Invalid registration for this scan session" }, { status: 400 }); }
    const previous = capture.manifest.assets.find((a: {kind:string}) => a.kind === "splat");
    if (previous && previous.reconstructionMethod !== "lidar-initialized") return NextResponse.json({error:"A trained reconstruction already exists"},{status:409});
    const asset = {name:b.name,mediaRef:b.mediaRef,kind:"splat",reconstructionMethod:"trained",...(aligned ? {registration:aligned} : {})};
    // Replace only an untrained preview; keep its reference in history and preserve the scan origin.
    const result = previous
      ? await db.collection("spatialCaptures").updateOne({inspectionId:inspection._id,"manifest.assets":{$elemMatch:{name:previous.name,mediaRef:previous.mediaRef,reconstructionMethod:"lidar-initialized"}},"manifest.assets.name":{$ne:b.name}},{$set:{"manifest.assets.$":asset,reconstructionAddedAt:new Date()},$push:{reconstructionHistory:previous}} as never)
      : await db.collection("spatialCaptures").updateOne({ inspectionId: inspection._id, "manifest.assets.name": { $ne: b.name }, "manifest.assets.kind": { $ne: "splat" } }, { $push: { "manifest.assets": asset }, $set: { reconstructionAddedAt: new Date() } } as never);
    if (!result.modifiedCount) return NextResponse.json({ error: "Capture missing or a reconstruction already exists" }, { status: 409 });
    return NextResponse.json({ saved: true });
  } catch (e) { return errorResponse(e, "spatial.reconstruction"); }
}
