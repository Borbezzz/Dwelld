import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {getDb} from "@/lib/server/db";
import {requireUser} from "@/lib/server/access";
import {readJsonBody} from "@/lib/server/request-body";
import {errorResponse} from "@/lib/server/api-error";
export const runtime="nodejs";
export async function POST(request:Request){try{
 const user=await requireUser(request),body=await readJsonBody(request,2048),token=body.token;
 if(typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token))return NextResponse.json({error:"Invalid invitation"},{status:400});
 const db=await getDb(),hash=createHash("sha256").update(token).digest("hex"),now=new Date();
 const invite=await db.collection("spaceInvites").findOne({tokenHash:hash,email:user.email?.toLowerCase(),expiresAt:{$gt:now},acceptedAt:{$exists:false},revokedAt:{$exists:false}});
 if(!invite)return NextResponse.json({error:"Invite expired, used, or intended for a different signed-in email"},{status:404});
 const space=await db.collection("spaces").findOne({_id:invite.spaceId,ownerId:invite.ownerId});
 if(!space)return NextResponse.json({error:"Space no longer available"},{status:404});
 await db.collection("spaceMembers").createIndex({spaceId:1,userId:1},{unique:true});
 const claim=await db.collection("spaceInvites").updateOne({_id:invite._id,acceptedAt:{$exists:false},revokedAt:{$exists:false},expiresAt:{$gt:now}},{$set:{acceptedAt:now,acceptedBy:user.id}});
 if(!claim.modifiedCount)return NextResponse.json({error:"Invitation was already used"},{status:409});
 await db.collection("spaceMembers").updateOne({spaceId:invite.spaceId,userId:user.id},{$setOnInsert:{spaceId:invite.spaceId,userId:user.id,email:user.email?.toLowerCase(),role:invite.role,createdAt:now}},{upsert:true});
 return NextResponse.json({spaceId:String(space._id),name:space.name},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return errorResponse(e,"space.invites.accept")}}
