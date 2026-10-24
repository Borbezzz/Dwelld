import { NextResponse } from "next/server";
import { requireUser, requireOwnedRoom } from "@/lib/server/access";
import { readJsonBody } from "@/lib/server/request-body";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/api-error";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request), body = await readJsonBody(request);
    if (typeof body.roomId !== "string" || !["move-in", "move-out"].includes(body.inspectionType)) return NextResponse.json({ error: "Choose a room and inspection type" }, { status: 400 });
    const room = await requireOwnedRoom(body.roomId, user.id);
    const result = await (await getDb()).collection("inspections").insertOne({ roomId: room._id, ownerId: user.id, type: body.inspectionType, captureSource: "native-lidar", status: "queued", createdAt: new Date(), analysisWarnings: ["Native capture pending upload."] });
    return NextResponse.json({ inspectionId: String(result.insertedId) }, { status: 201 });
  } catch (error) { return errorResponse(error, "spatial.inspection.create"); }
}
