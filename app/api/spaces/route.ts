import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { readJsonBody } from "@/lib/server/request-body";
import { getDb } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Spaces group rooms within one property. Existing ungrouped rooms remain accessible. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const db = await getDb();
    const memberships = await db.collection("spaceMembers").find({userId:user.id},{projection:{spaceId:1,role:1}}).toArray();
    const spaces = await db.collection("spaces").find({$or:[{ownerId:user.id},...(memberships.length?[{_id:{$in:memberships.map(m=>m.spaceId)}}]:[])]}).sort({ createdAt: -1 }).limit(100).toArray();
    return NextResponse.json({ spaces: spaces.map(s => ({ id: String(s._id), name: s.name, createdAt: s.createdAt.toISOString(),role:s.ownerId===user.id?"owner":memberships.find(m=>String(m.spaceId)===String(s._id))?.role||"member" })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return errorResponse(e, "spaces.list"); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJsonBody(request, 4096);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return NextResponse.json({ error: "Space name must be between 1 and 80 characters" }, { status: 400 });
    const db = await getDb();
    const doc = { _id: new ObjectId(), ownerId: user.id, name, createdAt: new Date() };
    await db.collection("spaces").insertOne(doc);
    return NextResponse.json({ space: { id: String(doc._id), name, createdAt: doc.createdAt.toISOString() } }, { status: 201 });
  } catch (e) { return errorResponse(e, "spaces.create"); }
}
