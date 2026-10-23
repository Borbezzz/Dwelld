import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const id = parseObjectId(roomId);
  if (!id) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  try {
    const room = await (await getDb()).collection("rooms").findOne({ _id: id });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    return NextResponse.json({ room: { id: String(room._id), name: room.name, createdAt: new Date(room.createdAt).toISOString() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load room";
    return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid request body" : "The service could not complete this request. Check server configuration and try again." }, { status: error instanceof SyntaxError ? 400 : message.includes("not configured") ? 503 : 500 });
  }
}
