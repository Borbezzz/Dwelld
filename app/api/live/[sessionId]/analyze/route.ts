import sharp from "sharp";
import {randomUUID} from "node:crypto";
import type {LiveFinding} from "@/lib/live/types";
import {authenticateLive,liveCollections,liveFailure,LiveError,recordLiveAnalysis,validEventId} from "@/lib/server/live-sessions";
import {analyzeLiveFrame} from "@/lib/server/live-analysis";
import {writeMedia,deleteMedia} from "@/lib/server/media";
import {describeAtPoint} from "@/lib/server/damage";
export const runtime="nodejs";export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {sessionId}=await params;const {session}=await authenticateLive(request,sessionId,"phone");if(session.status==="saved")throw new LiveError("Session already saved",409);
 if(Number(request.headers.get("content-length"))>4*1024*1024)throw new LiveError("Evidence frame too large",413);
 const form=await request.formData();const file=form.get("image");const data=JSON.parse(String(form.get("metadata")||"{}"));
 if(!(file instanceof File)||file.size>3*1024*1024||!file.size||!validEventId(data.observationId)||!Number.isFinite(data.timestampSeconds)||data.timestampSeconds<0)throw new LiveError("Invalid evidence frame");
 const {db,sessions}=await liveCollections();const existing=await db.collection("liveAnalyses").findOne({sessionId:session._id,observationId:data.observationId});if(existing?.result)return Response.json(existing.result);
 const now=new Date(); const manual=data.mode==="manual"; const leaseId=randomUUID();
 const lock=manual
 ? await sessions.findOneAndUpdate({_id:session._id,inspectionId:{$exists:false},status:{$ne:"saved"},$or:[{manualUntil:{$exists:false}},{manualUntil:{$lte:now}}]},{$set:{manualUntil:new Date(+now+310000),manualLeaseId:leaseId}},{returnDocument:"after"})
 : await sessions.findOneAndUpdate({_id:session._id,inspectionId:{$exists:false},status:{$ne:"saved"},$or:[{analysisAfter:{$exists:false}},{analysisAfter:{$lte:now}}]},{$set:{analysisAfter:new Date(+now+310000),analysisInFlight:true}},{returnDocument:"after"});
 if(!lock)throw new LiveError(manual?"Another marker is being saved or the inspection is finalizing; retry shortly":"Damage analysis is already running or cooling down; retry shortly",429);
 try {
 const image=Buffer.from(await file.arrayBuffer());let result: {analysisWarnings?:string[];evidenceFrameRef:string;findings:LiveFinding[];analyzedObjectIds:string[];surfacesAnalyzed:boolean};
 if(data.mode==="manual"){
 const point=data.point;if(typeof data.description!=="string"||data.description.length>1000||!point||![point.x,point.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new LiveError("Choose a valid point");
 const seen=await describeAtPoint(image,point).catch(()=>null);if(!seen&&!data.description.trim())throw new LiveError("Couldn't describe that spot automatically. Add a short note and save again.",422);
 if(data.parentObjectId&&!await db.collection("liveObjects").findOne({sessionId:session._id,objectId:data.parentObjectId}))throw new LiveError("Object not found",404);
 const png=await sharp(image,{limitInputPixels:24000000}).rotate().png().toBuffer();const ref=await writeMedia(png,`live/${sessionId}/${data.observationId}.png`,"image/png");
 result={evidenceFrameRef:ref,findings:[{id:data.observationId,kind:"damage" as const,label:seen?.label||"Manual damage",description:[seen?.description,data.description.trim()&&(seen?`Your note: ${data.description.trim()}`:data.description.trim())].filter(Boolean).join(" "),...(seen?.boundingBox?{boundingBox:seen.boundingBox}:{}),point,timestampSeconds:data.timestampSeconds,parentObjectId:data.parentObjectId||null,source:"manual" as const}],analyzedObjectIds:[],surfacesAnalyzed:false};
 }else {const analyzed=await analyzeLiveFrame(image,{sessionId,observationId:data.observationId,timestampSeconds:data.timestampSeconds,objects:data.objects,includeSurfaces:!!data.includeSurfaces,fullFrame:true});result={...analyzed,findings:analyzed.findings.map(f=>({...f,kind:"damage" as const,boundingBox:f.boundingBox??undefined}))};}
 if(result.analysisWarnings?.length)await sessions.updateOne({_id:session._id},{$addToSet:{analysisWarnings:{$each:result.analysisWarnings}}});
 try{await recordLiveAnalysis(session,data.observationId,result);await db.collection("liveAnalyses").updateOne({sessionId:session._id,observationId:data.observationId},{$set:{result,createdAt:new Date()}},{upsert:true});}catch(error){await deleteMedia(result.evidenceFrameRef).catch(()=>{});throw error;}
 return Response.json(result);
 }finally{if(manual)await sessions.updateOne({_id:session._id,manualLeaseId:leaseId},{$unset:{manualUntil:"",manualLeaseId:""}});else await sessions.updateOne({_id:session._id},{$set:{analysisAfter:new Date(Date.now()+1000),analysisInFlight:false}});}
}catch(e){return liveFailure(e);}}
