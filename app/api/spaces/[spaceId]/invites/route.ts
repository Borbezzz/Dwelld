import {createHash,randomBytes} from "node:crypto";
import {NextResponse} from "next/server";
import {getDb,parseObjectId} from "@/lib/server/db";
import {requireUser} from "@/lib/server/access";
import {readJsonBody} from "@/lib/server/request-body";
import {errorResponse} from "@/lib/server/api-error";
export const runtime="nodejs";
type C={params:Promise<{spaceId:string}>};
export async function GET(request:Request,{params}:C){try{
 const user=await requireUser(request),id=parseObjectId((await params).spaceId),db=await getDb();
 if(!id)return NextResponse.json({error:"Space not found"},{status:404});
 const space=await db.collection("spaces").findOne({_id:id,ownerId:user.id});
 if(!space)return NextResponse.json({error:"Space not found"},{status:404});
 const members=await db.collection("spaceMembers").find({spaceId:id}).project({userId:1,role:1,createdAt:1,email:1}).toArray();
 const invites=await db.collection("spaceInvites").find({spaceId:id,expiresAt:{$gt:new Date()},acceptedAt:{$exists:false},revokedAt:{$exists:false}}).project({email:1,role:1,expiresAt:1}).toArray();
 return NextResponse.json({members:members.map(m=>({id:String(m._id),userId:m.userId,email:m.email,role:m.role})),invites:invites.map(i=>({id:String(i._id),email:i.email,role:i.role,expiresAt:i.expiresAt}))},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return errorResponse(e,"space.invites.list")}}
export async function POST(request:Request,{params}:C){try{
 const user=await requireUser(request),id=parseObjectId((await params).spaceId),body=await readJsonBody(request,4096),db=await getDb();
 if(!id||!await db.collection("spaces").findOne({_id:id,ownerId:user.id}))return NextResponse.json({error:"Space not found"},{status:404});
 const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!["tenant","landlord"].includes(String(body.role)))return NextResponse.json({error:"Valid email and tenant/landlord role required"},{status:400});
 if(email===user.email?.toLowerCase())return NextResponse.json({error:"You already own this space"},{status:400});
 const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+7*86400000);
 await db.collection("spaceInvites").insertOne({spaceId:id,ownerId:user.id,email,role:body.role,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt,createdAt:new Date()});
 const origin=new URL(request.url).origin;
 return NextResponse.json({url:`${origin}/invite?token=${encodeURIComponent(token)}`,expiresAt},{status:201,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 }catch(e){return errorResponse(e,"space.invites.create")}}
