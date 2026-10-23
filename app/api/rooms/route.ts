import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb, ensureIndexes } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The request could not be completed";
  const status = error instanceof SyntaxError ? 400 : message.includes("not configured") || message.includes("unavailable") ? 503 : 500;
  return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid request body" : "The service could not complete this request. Check server configuration and try again." }, { status });
}

export async function GET() {
  try {
    const db = await getDb();
    await ensureIndexes(db);
    const docs = await db.collection("rooms").find({}).sort({ createdAt: -1 }).limit(100).toArray();
    const rooms = docs.map((r) => ({ id: String(r._id), name: r.name, createdAt: new Date(r.createdAt).toISOString() }));
    return NextResponse.json({ rooms });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return NextResponse.json({ error: "Room name must be between 1 and 80 characters" }, { status: 400 });
    const db = await getDb();
    await ensureIndexes(db);
    const doc = { _id: new ObjectId(), name, createdAt: new Date() };
    await db.collection("rooms").insertOne(doc);
    return NextResponse.json({ room: { id: String(doc._id), name: doc.name, createdAt: doc.createdAt.toISOString() } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
