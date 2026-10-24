import { requireReadableInspection } from "@/lib/server/space-access";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { mediaResponse, parseMediaId } from "@/lib/server/media";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw || raw.length > 2048) return new NextResponse("Missing media URL", { status: 400 });
  try {
    const user = await requireUser(request);
    if (!parseMediaId(raw)) return new NextResponse("Not found", { status: 404 });
    const db = await getDb();
    const registered = await db.collection("inspections").findOne({ ownerId:user.id, $or:[{sourceUrl:raw},{"evidenceFrames.url":raw}] }, { projection: { _id: 1 } })
      || await db.collection("findings").findOne({ evidenceFrameUrl: raw, ownerId:user.id }, { projection: { _id: 1 } });
    const comparisonEvidence = !registered && await db.collection("comparisons").findOne({ownerId:user.id,evidenceRefs:raw},{projection:{_id:1}});
    if (!registered && !comparisonEvidence) {
      // A shared member can view evidence only if it belongs to an inspection in their space.
      const candidate=await db.collection("inspections").findOne({$or:[{sourceUrl:raw},{"evidenceFrames.url":raw}]},{projection:{_id:1}})
        || await db.collection("findings").findOne({evidenceFrameUrl:raw},{projection:{inspectionId:1}});
      if(!candidate)return new NextResponse("Not found",{status:404});
      try {await requireReadableInspection(candidate.inspectionId || candidate._id,user.id);}
      catch {return new NextResponse("Not found",{status:404});}
    }
    return await mediaResponse(raw, request);
  } catch (error) {
    return errorResponse(error, "app/api/media/route.ts");
  }
}
