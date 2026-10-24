import {NextResponse} from "next/server";
import {getDb,parseObjectId} from "@/lib/server/db";
import {requireUser} from "@/lib/server/access";
import {errorResponse} from "@/lib/server/api-error";
export const runtime="nodejs";
type C={params:Promise<{spaceId:string;inviteId:string}>};
export async function DELETE(request:Request,{params}:C){try{
 const user=await requireUser(request),{spaceId,inviteId}=await params,id=parseObjectId(spaceId),invite=parseObjectId(inviteId),db=await getDb();
 if(!id||!invite||!await db.collection("spaces").findOne({_id:id,ownerId:user.id}))return NextResponse.json({error:"Space not found"},{status:404});
 const result=await db.collection("spaceInvites").updateOne({_id:invite,spaceId:id,acceptedAt:{$exists:false},revokedAt:{$exists:false}},{$set:{revokedAt:new Date()}});
 return NextResponse.json({revoked:!!result.modifiedCount},{status:result.modifiedCount?200:404,headers:{"Cache-Control":"no-store"}});
 }catch(e){return errorResponse(e,"space.invites.revoke")}}
