import { requireUser,requireOwnedRoom } from "@/lib/server/access";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/api-error";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{roomId:string}>}){try{const user=await requireUser(request);const room=await requireOwnedRoom((await params).roomId,user.id);const links=await(await getDb()).collection("observationCorrespondences").find({roomId:room._id,ownerId:user.id,active:true}).sort({updatedAt:-1}).limit(500).toArray();return Response.json({correspondences:links});}catch(e){return errorResponse(e,"comparison.correspondences");}}
