import {readJsonBody} from "@/lib/server/request-body";
import { requireUser, requireOwnedRoom } from "@/lib/server/access";
import { canReadRoom } from "@/lib/server/space-access";
import { deleteRoom } from "@/lib/server/delete";
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
    const room = await (await getDb()).collection("rooms").findOne({ _id: id });
    if (!room || !await canReadRoom(room as never,user.id)) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    return NextResponse.json({ room: { id: String(room._id), name: room.name, createdAt: new Date(room.createdAt).toISOString(), spaceId: room.spaceId ? String(room.spaceId) : null } });
  } catch (error) {
    return errorResponse(error, "app/api/rooms/[roomId]/route.ts");
  }
}

export async function PATCH(request: Request, {params}: {params: Promise<{roomId:string}>}) {
 try { const user=await requireUser(request), id=parseObjectId((await params).roomId), body=await readJsonBody(request);
 const name=typeof body.name==="string"?body.name.trim():"";
 if(!id || (body.name !== undefined && (!name || name.length>80)))return NextResponse.json({error:"Provide a room name between 1 and 80 characters"},{status:400});
 if(body.name === undefined && body.spaceId === undefined)return NextResponse.json({error:"Nothing to update"},{status:400});
 const db=await getDb();
 const updates: Record<string,unknown>={updatedAt:new Date()};
 if(body.name !== undefined)updates.name=name;
 const unset: Record<string,string>={};
 if(body.spaceId !== undefined){
  if(body.spaceId === null)unset.spaceId="";
  else { const spaceId=typeof body.spaceId==="string"?parseObjectId(body.spaceId):null;
   if(!spaceId)return NextResponse.json({error:"Invalid spaceId"},{status:400});
   if(!await db.collection("spaces").findOne({_id:spaceId,ownerId:user.id},{projection:{_id:1}}))return NextResponse.json({error:"Space not found"},{status:404});
   updates.spaceId=spaceId;
  }
 }
 const room=await db.collection("rooms").findOneAndUpdate({_id:id,ownerId:user.id},{ $set: updates, ...(Object.keys(unset).length ? {$unset:unset}:{}) },{returnDocument:"after"});
 if(!room)return NextResponse.json({error:"Room not found"},{status:404});
 return NextResponse.json({room:{id:String(room._id),name:room.name,createdAt:new Date(room.createdAt).toISOString(),spaceId:room.spaceId?String(room.spaceId):null}});
 }catch(error){return errorResponse(error,"room.update");}
}

export async function DELETE(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const user = await requireUser(request);
    const room = await requireOwnedRoom((await params).roomId, user.id);
    return NextResponse.json({ deleted: true, ...(await deleteRoom(room)) });
  } catch (error) { return errorResponse(error, "room.delete"); }
}
