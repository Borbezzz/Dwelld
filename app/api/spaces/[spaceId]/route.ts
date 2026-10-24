import {NextResponse} from "next/server";
import {getDb,parseObjectId} from "@/lib/server/db";
import {requireUser} from "@/lib/server/access";
import {canReadRoom} from "@/lib/server/space-access";
import {readJsonBody} from "@/lib/server/request-body";
import {errorResponse} from "@/lib/server/api-error";
export const runtime="nodejs";
type C={params:Promise<{spaceId:string}>};
export async function GET(request:Request,{params}:C){try{
 const user=await requireUser(request),id=parseObjectId((await params).spaceId),db=await getDb();
 const space=id?await db.collection("spaces").findOne({_id:id}):null;
 if(!space)return NextResponse.json({error:"Space not found"},{status:404});
 const member=space.ownerId===user.id?null:await db.collection("spaceMembers").findOne({spaceId:id,userId:user.id});
 if(space.ownerId!==user.id&&!member)return NextResponse.json({error:"Space not found"},{status:404});
 const rooms=await db.collection("rooms").find({spaceId:id}).sort({createdAt:1}).toArray();
 return NextResponse.json({space:{id:String(space._id),name:space.name,role:space.ownerId===user.id?"owner":member?.role,createdAt:space.createdAt.toISOString()},rooms:rooms.map(r=>({id:String(r._id),name:r.name,spaceId:String(id),createdAt:r.createdAt.toISOString(),isOwner:r.ownerId===user.id}))},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return errorResponse(e,"space.read")}}
export async function PATCH(request:Request,{params}:C){try{
 const user=await requireUser(request),id=parseObjectId((await params).spaceId),body=await readJsonBody(request,2048);
 const name=typeof body.name==="string"?body.name.trim():"";if(!id||!name||name.length>80)return NextResponse.json({error:"Name must be 1–80 characters"},{status:400});
 const space=await(await getDb()).collection("spaces").findOneAndUpdate({_id:id,ownerId:user.id},{$set:{name,updatedAt:new Date()}},{returnDocument:"after"});
 if(!space)return NextResponse.json({error:"Space not found"},{status:404});
 return NextResponse.json({space:{id:String(space._id),name:space.name}});
 }catch(e){return errorResponse(e,"space.rename")}}
export async function DELETE(request:Request,{params}:C){try{
 const user=await requireUser(request),id=parseObjectId((await params).spaceId),db=await getDb();
 if(!id||!await db.collection("spaces").findOne({_id:id,ownerId:user.id}))return NextResponse.json({error:"Space not found"},{status:404});
 if(await db.collection("rooms").findOne({spaceId:id},{projection:{_id:1}}))return NextResponse.json({error:"Move or remove the rooms before deleting this space"},{status:409});
 await Promise.all([db.collection("spaceMembers").deleteMany({spaceId:id}),db.collection("spaceInvites").deleteMany({spaceId:id})]);
 await db.collection("spaces").deleteOne({_id:id,ownerId:user.id});
 return NextResponse.json({deleted:true},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return errorResponse(e,"space.delete")}}
