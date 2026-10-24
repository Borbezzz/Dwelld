import {canReadRoom} from "@/lib/server/space-access";
import {parseObjectId} from "@/lib/server/db";
import { requireUser } from "@/lib/server/access";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/api-error";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{roomId:string}>}){try{const user=await requireUser(request);const id=parseObjectId((await params).roomId),db=await getDb(),room=id?await db.collection("rooms").findOne({_id:id}):null;if(!room||!await canReadRoom(room as never,user.id))return Response.json({error:"Room not found"},{status:404});const links=await db.collection("observationCorrespondences").find({roomId:room._id,active:true}).sort({updatedAt:-1}).limit(500).toArray();return Response.json({correspondences:links});}catch(e){return errorResponse(e,"comparison.correspondences");}}
