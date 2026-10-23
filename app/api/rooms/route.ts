import {readJsonBody} from "@/lib/server/request-body";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb, ensureIndexes } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const db = await getDb();
    await ensureIndexes(db);
    const docs = await db.collection("rooms").find({ownerId:user.id}).sort({ createdAt: -1 }).limit(100).toArray();
    const rooms = docs.map((r) => ({ id: String(r._id), name: r.name, createdAt: new Date(r.createdAt).toISOString() }));
    return NextResponse.json({ rooms });
  } catch (error) { return errorResponse(error, "app/api/rooms/route.ts"); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJsonBody(request) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return NextResponse.json({ error: "Room name must be between 1 and 80 characters" }, { status: 400 });
    const db = await getDb();
    await ensureIndexes(db);
    const doc = { _id: new ObjectId(), ownerId:user.id, name, createdAt: new Date() };
    await db.collection("rooms").insertOne(doc);
    return NextResponse.json({ room: { id: String(doc._id), name: doc.name, createdAt: doc.createdAt.toISOString() } }, { status: 201 });
  } catch (error) { return errorResponse(error, "app/api/rooms/route.ts"); }
}
