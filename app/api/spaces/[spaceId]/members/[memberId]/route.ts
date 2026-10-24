import {NextResponse} from "next/server";
import {getDb,parseObjectId} from "@/lib/server/db";
import {requireUser} from "@/lib/server/access";
import {errorResponse} from "@/lib/server/api-error";
export const runtime="nodejs";
type C={params:Promise<{spaceId:string;memberId:string}>};
export async function DELETE(request:Request,{params}:C){try{
 const user=await requireUser(request),{spaceId,memberId}=await params,id=parseObjectId(spaceId),member=parseObjectId(memberId),db=await getDb();
 if(!id||!member||!await db.collection("spaces").findOne({_id:id,ownerId:user.id}))return NextResponse.json({error:"Space not found"},{status:404});
 const removed=await db.collection("spaceMembers").deleteOne({_id:member,spaceId:id});
 return NextResponse.json({removed:!!removed.deletedCount},{status:removed.deletedCount?200:404,headers:{"Cache-Control":"no-store"}});
 }catch(e){return errorResponse(e,"space.member.revoke")}}
