import { ObjectId, type Db } from "mongodb";
import { analyzeVideo, type VideoCheckpoint } from "./inspection";
import { autoReviewInspection } from "./verify";
import { indexFindings } from "./search";
import { reportError } from "./api-error";

/** Publish real evidence/observations as each batch finishes; IDs and human reviews survive polling. */
export async function runVideoInspection(db: Db, inspectionId: ObjectId, ownerId: string, roomId: ObjectId, videoUrl: string, mimeType: string, detectionFrames: unknown) {
 const inspections=db.collection('inspections'), ids=new Map<string,ObjectId>(),saved=new Set<string>();
 let writes:Promise<void>=Promise.resolve();
 const persist=(point:VideoCheckpoint)=>{
  const write=async()=>{
   for(const f of point.findings)if(!ids.has(f.detectionId))ids.set(f.detectionId,new ObjectId());
   const fresh=point.findings.filter(f=>!saved.has(f.detectionId));
   if(fresh.length){await db.collection('findings').insertMany(fresh.map(f=>({_id:ids.get(f.detectionId)!,ownerId,inspectionId,roomId,...f,objectId:f.parentDetectionId?ids.get(f.parentDetectionId)||null:null,source:'ai',reviewStatus:'pending',reviewHistory:[],createdAt:new Date()})));fresh.forEach(f=>saved.add(f.detectionId));}
   await inspections.updateOne({_id:inspectionId},{$set:{evidenceFrames:point.evidenceFrames,analysisRunId:point.analysisRunId,analysisWarnings:point.warnings,durationSeconds:point.durationSeconds,analysisProgress:{phase:point.phase,totalFrames:point.totalFrames,processedFrames:point.processedFrames,updatedAt:new Date().toISOString()}}});
  };
  writes=writes.then(write);return writes;
 };
 try{
  const result=await analyzeVideo(videoUrl,mimeType,detectionFrames,persist);
  await writes;
  await inspections.updateOne({_id:inspectionId},{$set:{evidenceFrames:result.evidenceFrames,analysisWarnings:result.warnings,analysisRunId:result.analysisRunId,'analysisProgress.phase':'verifying'}});
  const review=await autoReviewInspection(inspectionId,{limit:6,concurrency:3,timeoutMs:15_000,deadlineMs:Date.now()+35_000}).catch(()=>null);
  await inspections.updateOne({_id:inspectionId},{$set:{...(review?{autoReview:review}:{}),status:result.warnings.length?'partial':'completed',analysisWarnings:result.warnings,durationSeconds:result.durationSeconds,completedAt:new Date(),'analysisProgress.phase':'complete'}});
  await indexFindings(ownerId,inspectionId,{limit:6,timeoutMs:5000,deadlineMs:Date.now()+10_000}).catch(()=>{});
 }catch(error){
  await writes.catch(()=>{});
  const failure=reportError(error,'inspection.analyze');
  await inspections.updateOne({_id:inspectionId},{$set:{status:'failed',error:`${failure.error} Request ID: ${failure.requestId}`,failedAt:new Date(),'analysisProgress.phase':'failed'}});
 }
}
