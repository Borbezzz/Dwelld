import {readJsonBody} from "@/lib/server/request-body";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const id = parseObjectId(roomId);
  if (!id) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  try {
    const user = await requireUser(request);
    const room = await (await getDb()).collection("rooms").findOne({ _id: id, ownerId:user.id });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    return NextResponse.json({ room: { id: String(room._id), name: room.name, createdAt: new Date(room.createdAt).toISOString() } });
  } catch (error) {
    return errorResponse(error, "app/api/rooms/[roomId]/route.ts");
  }
}

export async function PATCH(request: Request, {params}: {params: Promise<{roomId:string}>}) {
 try { const user=await requireUser(request), id=parseObjectId((await params).roomId), body=await readJsonBody(request);
 const name=typeof body.name==="string"?body.name.trim():"";
 if(!id||!name||name.length>80)return NextResponse.json({error:"Provide a room name between 1 and 80 characters"},{status:400});
 const room=await (await getDb()).collection("rooms").findOneAndUpdate({_id:id,ownerId:user.id},{$set:{name,updatedAt:new Date()}},{returnDocument:"after"});
 if(!room)return NextResponse.json({error:"Room not found"},{status:404});
 return NextResponse.json({room:{id:String(room._id),name:room.name,createdAt:new Date(room.createdAt).toISOString()}});
 }catch(error){return errorResponse(error,"room.update");}
}
