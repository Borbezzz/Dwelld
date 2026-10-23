import {readJsonBody} from "@/lib/server/request-body";
import {createHash,randomUUID} from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { requireUser, requireOwnedRoom, requireOwnedInspection } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { deleteMedia } from "@/lib/server/media";
import { compareInspections } from "@/lib/server/comparison";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:Request){try{const user=await requireUser(request);const roomId=new URL(request.url).searchParams.get("roomId")||"";const room=await requireOwnedRoom(roomId,user.id);const rows=await(await getDb()).collection("comparisons").find({roomId:room._id,ownerId:user.id},{projection:{roomId:1,baselineInspectionId:1,currentInspectionId:1,createdAt:1}}).sort({createdAt:-1}).limit(50).toArray();return NextResponse.json({comparisons:rows.map(({_id,...r})=>({...r,id:String(_id)}))});}catch(e){return errorResponse(e,"comparison.list");}}
export async function POST(request:Request){try{
 const user=await requireUser(request);const body=await readJsonBody(request);
 if(typeof body.baselineInspectionId!=="string"||typeof body.currentInspectionId!=="string"||body.baselineInspectionId===body.currentInspectionId)return NextResponse.json({error:"Choose two distinct inspections."},{status:400});
 const [baseline,current]=await Promise.all([requireOwnedInspection(body.baselineInspectionId,user.id),requireOwnedInspection(body.currentInspectionId,user.id)]);
 if(String(baseline.roomId)!==String(current.roomId))return NextResponse.json({error:"Inspections must belong to the same room."},{status:400});
 if(![baseline,current].every(i=>["completed","partial"].includes(i.status))||new Date(baseline.createdAt)>=new Date(current.createdAt))return NextResponse.json({error:"Choose an earlier completed baseline and a later completed inspection."},{status:400});
 const db=await getDb();const key=createHash("sha256").update(`${user.id}:${baseline.roomId}`).digest("hex"),leaseId=randomUUID();
 const locks=db.collection<{_id:string;leaseId:string;expiresAt:Date}>("comparisonLeases");
 let lease;try{lease=await locks.findOneAndUpdate({_id:key,$or:[{expiresAt:{$lte:new Date()}},{leaseId}]},{$set:{leaseId,expiresAt:new Date(Date.now()+330_000)}},{upsert:true,returnDocument:"after"});}catch(e){if((e as {code?:number}).code===11000)return NextResponse.json({error:"A comparison is already running for this room. Wait for it to finish before retrying."},{status:409});throw e;}
 if(!lease)return NextResponse.json({error:"A comparison is already running."},{status:409});
 try{const result=await compareInspections(baseline,current);const doc={...result,ownerId:user.id,roomId:baseline.roomId,baselineInspectionId:baseline._id,currentInspectionId:current._id,createdAt:new Date(),reviews:[]};
 let saved;try{saved=await db.collection("comparisons").insertOne(doc);}catch(e){await Promise.allSettled(result.generatedRefs.map(ref=>deleteMedia(ref)));throw e;}return NextResponse.json({comparison:{...doc,id:String(saved.insertedId)}},{status:201});}finally{await locks.deleteOne({_id:key,leaseId}).catch(()=>{});}
 }catch(e){if(e instanceof Error&&["Comparison needs saved image evidence","Both inspections need readable saved image evidence"].includes(e.message))return NextResponse.json({error:"Both inspections need readable image evidence or an original recording before they can be compared."},{status:422});return errorResponse(e,"comparison.create");}}
