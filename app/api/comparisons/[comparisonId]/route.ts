import {readJsonBody} from "@/lib/server/request-body";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {canReadRoom} from "@/lib/server/space-access";
import { getDb,getClientPromise,parseObjectId } from "@/lib/server/db";
import { requireUser } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import type { ComparisonChange,ComparisonEvidence } from "@/lib/comparison";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type StoredComparison={_id:ObjectId;ownerId:string;roomId:ObjectId;baselineInspectionId:ObjectId;currentInspectionId:ObjectId;baseline:ComparisonEvidence[];current:ComparisonEvidence[];changes:ComparisonChange[];reviews:{changeId:string;status:string;note:string;at:Date;reviewerId:string}[]};
export async function PATCH(request:Request,{params}:{params:Promise<{comparisonId:string}>}){try{
 const user=await requireUser(request);const id=parseObjectId((await params).comparisonId);if(!id)return NextResponse.json({error:"Comparison not found"},{status:404});
 const {changeId,status,note}=await readJsonBody(request);if(typeof changeId!=="string"||!["confirmed","rejected","pending"].includes(status)||typeof note!=="string"||note.length>2000)return NextResponse.json({error:"Choose a valid review status and a note of at most 2000 characters."},{status:400});
 const db=await getDb();const session=(await getClientPromise()).startSession();
 try{const result=await session.withTransaction(async()=>{
  const record=await db.collection<StoredComparison>("comparisons").findOneAndUpdate({_id:id,ownerId:user.id,"changes.id":changeId},{$set:{"changes.$.reviewStatus":status},$push:{reviews:{changeId,status,note:note.trim(),at:new Date(),reviewerId:user.id}}},{returnDocument:"after",session});
  if(!record)return null;
  const change=record.changes.find(c=>c.id===changeId)!;
  // Keep a durable, revocable correspondence rather than destructively merging observations.
  // Rejection/reset deactivates this source; all original evidence and review history remain.
  const baseline=record.baseline.find(f=>f.id===change.baselineFindingId),current=record.current.find(f=>f.id===change.currentFindingId);
  if(baseline&&current){await db.collection<{_id:string;ownerId:string;roomId:ObjectId;comparisonId:ObjectId;changeId:string;baselineFindingId:string;currentFindingId:string;baselineInspectionId:ObjectId;currentInspectionId:ObjectId;kind:string;active:boolean;updatedAt:Date}>("observationCorrespondences").updateOne({_id:`${id}:${changeId}`},{$set:{ownerId:user.id,roomId:record.roomId,comparisonId:id,changeId,baselineFindingId:baseline.id,currentFindingId:current.id,baselineInspectionId:record.baselineInspectionId,currentInspectionId:record.currentInspectionId,kind:baseline.kind===current.kind?baseline.kind:"mixed",active:status==="confirmed",updatedAt:new Date()}},{upsert:true,session});}
  return record;
 });if(!result)return NextResponse.json({error:"Comparison not found"},{status:404});return NextResponse.json({comparison:{...result,id:String(result._id)}});
 }finally{await session.endSession();}
 }catch(e){return errorResponse(e,"comparison.review");}}

export async function GET(request:Request,{params}:{params:Promise<{comparisonId:string}>}){try{const user=await requireUser(request);const id=parseObjectId((await params).comparisonId);const record=id?await(await getDb()).collection("comparisons").findOne({_id:id}):null;const room=record?await(await getDb()).collection("rooms").findOne({_id:record.roomId}):null;if(!record||!room||!await canReadRoom(room as never,user.id))return NextResponse.json({error:"Comparison not found"},{status:404});return NextResponse.json({comparison:{...record,id:String(record._id)}});}catch(e){return errorResponse(e,"comparison.read");}}
