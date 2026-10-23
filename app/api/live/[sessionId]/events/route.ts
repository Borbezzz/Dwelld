import {authenticateLive,liveCollections,liveFailure,LiveError,validEventId} from "@/lib/server/live-sessions";
import {validBox} from "@/lib/server/damage";
const COCO_LABELS: Record<number,string> = {56:"chair",57:"couch",58:"potted plant",59:"bed",60:"dining table",61:"toilet",62:"tv",63:"laptop",68:"microwave",69:"oven",70:"toaster",71:"sink",72:"refrigerator",74:"clock",75:"vase"};
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {sessionId}=await params;const {session,role}=await authenticateLive(request,sessionId);const b=await request.json();const p=b.payload||{};if(!validEventId(b.eventId))throw new LiveError("Invalid event ID");const {db,sessions}=await liveCollections();
 if(await db.collection("liveEvents").findOne({sessionId:session._id,eventId:b.eventId}))return Response.json({ok:true});
 if(session.status==="saved")throw new LiveError("Inspection already saved",409);
 switch(b.type){
 case "objects.updated": {
 if(role!=="phone")throw new LiveError("Only the paired phone may publish detections",403);
 if(!Array.isArray(p.objects)||p.objects.length>100)throw new LiveError("Invalid inventory");
 for(const o of p.objects){if(!validEventId(o.objectId)||!validBox(o.boundingBox)||!Number.isInteger(o.classId)||COCO_LABELS[o.classId]!==o.label||!Number.isFinite(o.confidence)||o.confidence<0||o.confidence>1||!Number.isFinite(o.firstSeenSeconds)||!Number.isFinite(o.lastSeenSeconds)||o.firstSeenSeconds<0||o.lastSeenSeconds<o.firstSeenSeconds||!Number.isSafeInteger(o.observations)||o.observations<1)throw new LiveError("Invalid object observation");}
 for(const o of p.objects)await db.collection("liveObjects").updateOne({sessionId:session._id,objectId:o.objectId},{$set:{label:o.label,classId:o.classId,confidence:o.confidence,boundingBox:o.boundingBox},$min:{firstSeenSeconds:o.firstSeenSeconds},$max:{lastSeenSeconds:o.lastSeenSeconds,observations:o.observations},$setOnInsert:{sessionId:session._id,objectId:o.objectId}},{upsert:true});break;}
 case "scan.started":if(role!=="phone")throw new LiveError("Phone required",403);await sessions.updateOne({_id:session._id,status:{$in:["connected","recording"]}},{$set:{status:"recording"}});break;
 case "scan.stop_requested":await sessions.updateOne({_id:session._id},{$set:{stopRequested:true,status:"stopping"}});break;
 case "phone.connected":case "phone.disconnected":if(role!=="phone")throw new LiveError("Phone required",403);break;
 case "finding.reviewed":{
 if(!validEventId(p.findingId)||!["pending","confirmed","rejected"].includes(p.reviewStatus))throw new LiveError("Invalid review");
 const found=await db.collection("liveFindings").findOne({sessionId:session._id,id:p.findingId});if(!found)throw new LiveError("Finding not found",404);
 await db.collection<{sessionId:typeof session._id;id:string;reviewStatus:string;reviewHistory:Record<string,unknown>[]}>("liveFindings").updateOne({sessionId:session._id,id:p.findingId,"reviewHistory.eventId":{$ne:b.eventId}},{$set:{reviewStatus:p.reviewStatus},$push:{reviewHistory:{eventId:b.eventId,reviewStatus:p.reviewStatus,reviewedAt:new Date(),device:role}}});break;}
 default:throw new LiveError("Unsupported event type");
 }
 await db.collection("liveEvents").updateOne({sessionId:session._id,eventId:b.eventId},{$setOnInsert:{sessionId:session._id,eventId:b.eventId,type:b.type,createdAt:new Date()}},{upsert:true});return Response.json({ok:true});
}catch(e){return liveFailure(e);}}
