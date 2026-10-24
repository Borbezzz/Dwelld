import type {Document} from "mongodb";
import {readJsonBody} from "@/lib/server/request-body";
import {createHash,randomUUID} from "node:crypto";
import { NextResponse } from "next/server";
import {requireReadableInspection,canReadRoom} from "@/lib/server/space-access";
import { getDb,parseObjectId } from "@/lib/server/db";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { deleteMedia } from "@/lib/server/media";
import { compareInspections } from "@/lib/server/comparison";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:Request){try{const user=await requireUser(request);const roomId=new URL(request.url).searchParams.get("roomId")||"";const id=parseObjectId(roomId),db=await getDb(),room=id?await db.collection("rooms").findOne({_id:id}):null;if(!room||!await canReadRoom(room as never,user.id))return NextResponse.json({error:"Room not found"},{status:404});const rows=await db.collection("comparisons").find({roomId:room._id},{projection:{roomId:1,baselineInspectionId:1,currentInspectionId:1,createdAt:1}}).sort({createdAt:-1}).limit(50).toArray();const job=await db.collection<Document & {_id:string}>('comparisonLeases').findOne({_id:createHash('sha256').update(String(id)).digest('hex')});
 let automatic=await db.collection('inspections').findOne({roomId:id,reportComparisonStatus:'processing'},{projection:{baselineInspectionId:1,createdAt:1,comparisonProgress:1}});
 if(automatic&&Date.now()-new Date(automatic.createdAt).getTime()>7*60_000)automatic=null;
 const running=job?.status==='processing'&&new Date(job.expiresAt)>new Date();
 const activeComparison=running?{id:String(job._id),status:job.status,startedAt:job.startedAt,progress:job.progress,baselineInspectionId:String(job.baselineInspectionId),currentInspectionId:String(job.currentInspectionId)}:automatic?{id:`automatic-${automatic._id}`,status:'processing',baselineInspectionId:String(automatic.baselineInspectionId||''),currentInspectionId:String(automatic._id),startedAt:automatic.createdAt,progress:automatic.comparisonProgress}:null;
 return NextResponse.json({activeComparison,lastJob:job?{status:job.status==='processing'&&!running?'failed':job.status,error:job.status==='processing'&&!running?'This comparison stopped before completion. You can retry the saved scans.':job.error,baselineInspectionId:String(job.baselineInspectionId),currentInspectionId:String(job.currentInspectionId)}:null,comparisons:rows.map(({_id,...r})=>({...r,id:String(_id)}))});}catch(e){return errorResponse(e,"comparison.list");}}
export async function POST(request:Request){try{
 const user=await requireUser(request);const body=await readJsonBody(request);
 if(typeof body.baselineInspectionId!=="string"||typeof body.currentInspectionId!=="string"||body.baselineInspectionId===body.currentInspectionId)return NextResponse.json({error:"Choose two distinct inspections."},{status:400});
 if(!parseObjectId(body.baselineInspectionId)||!parseObjectId(body.currentInspectionId))return NextResponse.json({error:"Invalid inspection IDs"},{status:400});
 const [baseline,current]=await Promise.all([requireReadableInspection(parseObjectId(body.baselineInspectionId)!,user.id),requireReadableInspection(parseObjectId(body.currentInspectionId)!,user.id)]);
 const db=await getDb();
 const targetId=typeof body.roomId==="string"?parseObjectId(body.roomId):baseline.roomId;
 if(!targetId)return NextResponse.json({error:"Invalid target room"},{status:400});
 const comparisonRoom=await db.collection("rooms").findOne({_id:targetId});
 if(!comparisonRoom||!await canReadRoom(comparisonRoom as never,user.id))return NextResponse.json({error:"Room access required to compare shared scans"},{status:403});
 const segments=await db.collection("roomScanSegments").find({sourceInspectionId:{$in:[baseline._id,current._id]},roomId:targetId}).toArray();
 const scoped=[baseline,current].map(inspection=>{
   const segment=segments.find(s=>String(s.sourceInspectionId)===String(inspection._id));
   if(String(inspection.roomId)!==String(targetId)&&!segment)return null;
   return segment?{...inspection,roomId:targetId,segmentStartTime:segment.startTime,segmentEndTime:segment.endTime}:inspection;
 });
 if(scoped.some(i=>!i))return NextResponse.json({error:"Both scans must cover this room"},{status:400});
 if(![baseline,current].every(i=>["completed","partial"].includes(i.status))||new Date(baseline.createdAt)>=new Date(current.createdAt))return NextResponse.json({error:"Choose an earlier completed baseline and a later completed inspection."},{status:400});
 const key=createHash("sha256").update(String(targetId)).digest("hex"),leaseId=randomUUID();
 const locks=db.collection<Document & {_id:string}>("comparisonLeases");
 let lease;try{lease=await locks.findOneAndUpdate({_id:key,$or:[{expiresAt:{$lte:new Date()}},{leaseId}]},{$set:{leaseId,expiresAt:new Date(Date.now()+330_000),roomId:targetId,status:"processing",baselineInspectionId:baseline._id,currentInspectionId:current._id,startedAt:new Date(),progress:{phase:"Preparing saved evidence"},error:null}},{upsert:true,returnDocument:"after"});}catch(e){if((e as {code?:number}).code===11000)return NextResponse.json({error:"A comparison is already running for this room. Wait for it to finish before retrying."},{status:409});throw e;}
 if(!lease)return NextResponse.json({error:"A comparison is already running."},{status:409});
 try{const result=await compareInspections(scoped[0]!,scoped[1]!,{onProgress:async progress=>{await locks.updateOne({_id:key,leaseId},{$set:{progress,updatedAt:new Date()}});}});const doc={...result,ownerId:user.id,roomId:targetId,baselineInspectionId:baseline._id,currentInspectionId:current._id,createdAt:new Date(),reviews:[]};
 let saved;try{saved=await db.collection("comparisons").insertOne(doc);}catch(e){await Promise.allSettled(result.generatedRefs.map(ref=>deleteMedia(ref)));throw e;}await locks.updateOne({_id:key,leaseId},{$set:{status:"ready",comparisonId:saved.insertedId,expiresAt:new Date()}});return NextResponse.json({comparison:{...doc,id:String(saved.insertedId)}},{status:201});}catch(error){await locks.updateOne({_id:key,leaseId},{$set:{status:"failed",error:error instanceof Error?error.message:"Comparison could not finish",expiresAt:new Date()}}).catch(()=>{});throw error;}
 }catch(e){if(e instanceof Error&&["Comparison needs saved image evidence","Both inspections need readable saved image evidence"].includes(e.message))return NextResponse.json({error:"Both inspections need readable image evidence or an original recording before they can be compared."},{status:422});return errorResponse(e,"comparison.create");}}
