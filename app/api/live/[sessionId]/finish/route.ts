import {after} from "next/server";
import {indexFindings} from "@/lib/server/search";
import {createHash} from "node:crypto";
import {ObjectId} from "mongodb";
import {authenticateLive,liveCollections,liveFrameProgress,liveFailure,LiveError} from "@/lib/server/live-sessions";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {sessionId}=await params;let {session}=await authenticateLive(request,sessionId);const body=await request.json();const {db,sessions}=await liveCollections();
 if(session.status==="saved")return Response.json({inspectionId:String(session.inspectionId)});
 if(session.manualUntil && session.manualUntil>new Date())throw new LiveError("A marked frame is still being saved; retry shortly",409);
 if(session.analysisInFlight && session.analysisAfter && session.analysisAfter>new Date())throw new LiveError("Damage analysis is still running; wait for its result before saving",409);
 if(!session.sourceUrl)throw new LiveError("The phone must finish uploading original footage first",409);
 if(!Number.isFinite(body.durationSeconds)||body.durationSeconds<=0||body.durationSeconds>7200)throw new LiveError("Invalid recording duration");
 // Reserve a stable inspection identity so retried or concurrent finalization cannot duplicate records.
 await sessions.updateOne({_id:session._id,inspectionId:{$exists:false},$and:[{$or:[{analysisInFlight:{$ne:true}},{analysisAfter:{$lte:new Date()}}]},{$or:[{manualUntil:{$exists:false}},{manualUntil:{$lte:new Date()}}]}]},{$set:{inspectionId:new ObjectId(),status:"stopping",stopRequested:true}});
 session=(await sessions.findOne({_id:session._id}))!;const inspectionId=session.inspectionId; if(!inspectionId)throw new LiveError("Damage analysis is still running; retry saving shortly",409);
 const frameProgress=await liveFrameProgress(session._id);
 const blocked=!!(session.analysisIssue as {blocksService?:boolean}|undefined)?.blocksService;
 if((frameProgress.queued||frameProgress.checking)&&!blocked)throw new LiveError("Source photos are still being checked; retry saving shortly",409);
 const sourceFrames=await db.collection("liveFrames").find({sessionId:session._id}).sort({timestampSeconds:1}).toArray();
 const objects=await db.collection("liveObjects").find({sessionId:session._id}).toArray();const findings=await db.collection("liveFindings").find({sessionId:session._id}).toArray();
 const stableId=(id:string)=>new ObjectId(createHash("sha256").update(`${sessionId}:${id}`).digest("hex").slice(0,24));
 for(const object of objects){const id=stableId(object.objectId);await db.collection("findings").updateOne({_id:id},{$setOnInsert:{_id:id,inspectionId,roomId:session.roomId,ownerId:session.ownerId,kind:"object",label:object.label,boundingBox:object.boundingBox,timestampSeconds:object.lastSeenSeconds,detectionSource:"yolo",source:"ai",reviewStatus:"pending",reviewHistory:[],createdAt:new Date(),liveObjectId:object.objectId}},{upsert:true});}
 for(const finding of findings){const {_id:unused,sessionId:unusedSession,id,...fields}=finding;await db.collection("findings").updateOne({_id:stableId(id)},{$setOnInsert:{...fields,kind:"damage",inspectionId,roomId:session.roomId,ownerId:session.ownerId,evidenceFrameUrl:finding.evidenceFrameRef,objectId:finding.parentObjectId?stableId(finding.parentObjectId):null,createdAt:finding.createdAt||new Date()}},{upsert:true});}
 await db.collection("inspections").updateOne({_id:inspectionId},{$setOnInsert:{_id:inspectionId,roomId:session.roomId,ownerId:session.ownerId,type:session.type||"move-in",sourceUrl:session.sourceUrl,evidenceFrames:sourceFrames.map(f=>({url:f.ref,timestampSeconds:f.timestampSeconds})),videoMimeType:session.videoMimeType,status:(frameProgress.failed||blocked)?"partial":"completed",createdAt:session.createdAt,completedAt:new Date(),durationSeconds:body.durationSeconds,detector:"yolo11n-coco-live",liveSessionId:session._id,analysisWarnings:[...(session.analysisWarnings||[]),...(blocked?[session.analysisIssue!.message+" Source photos and recording remain stored; this scan is incomplete."]:[]),"Argon examines one source frame per captured second; revisit missed areas. Tracking does not guarantee identity across all camera movements."]}},{upsert:true});
 await sessions.updateOne({_id:session._id},{$set:{status:"saved"}});after(async()=>{await indexFindings(session.ownerId,inspectionId).catch(()=>{});});return Response.json({inspectionId:String(inspectionId)});
}catch(e){return liveFailure(e);}}
