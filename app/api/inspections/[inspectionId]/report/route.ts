import {canReadRoom,requireReadableInspection} from '@/lib/server/space-access';
import { getDb, parseObjectId } from '@/lib/server/db';
import { requireUser, requireOwnedInspection } from '@/lib/server/access';
import { errorResponse } from '@/lib/server/api-error';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{inspectionId:string}>}){
 try{
  const user=await requireUser(request);const {inspectionId}=await params;const id=parseObjectId(inspectionId);if(!id)return Response.json({error:'Inspection not found'},{status:404});const inspection=await requireReadableInspection(id,user.id);const db=await getDb();
  const roomParam=new URL(request.url).searchParams.get('roomId');
  const target=roomParam?parseObjectId(roomParam):inspection.roomId;
  if(!target)return Response.json({error:'Invalid room'},{status:400});
  const segment=await db.collection('roomScanSegments').findOne({sourceInspectionId:id,roomId:target});
  const room=await db.collection('rooms').findOne({_id:target});
  if(String(target)!==String(inspection.roomId)&&(!segment||!room||!await canReadRoom(room as never,user.id)))return Response.json({error:'Room not found'},{status:404});
  const findings=await db.collection('findings').find({inspectionId:id,...(segment?{timestampSeconds:{$gte:segment.startTime,$lt:segment.endTime}}:{})}).sort({timestampSeconds:1,createdAt:1}).toArray();
  const serialize=(f:typeof findings[number])=>({id:String(f._id),kind:f.kind,label:f.label,description:f.description||'',reviewStatus:f.reviewStatus||'pending',timestampSeconds:f.timestampSeconds??null,point:f.point??null,boundingBox:f.boundingBox??null,evidenceFrameUrl:f.evidenceFrameUrl?`/api/media?url=${encodeURIComponent(f.evidenceFrameUrl)}`:null,source:f.source||'ai',detectionSource:f.detectionSource||null,objectId:f.objectId?String(f.objectId):null});
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),inspection:{id:inspectionId,roomId:String(target),roomName:room?.name||'Room',createdAt:inspection.createdAt,status:inspection.status,durationSeconds:inspection.durationSeconds??null,videoUrl:`/api/inspections/${inspectionId}/video`},inventory:findings.filter(f=>f.kind==='object'&&f.reviewStatus!=='rejected').map(serialize),confirmedDamage:findings.filter(f=>f.kind==='damage'&&f.reviewStatus==='confirmed').map(serialize),pendingDamage:findings.filter(f=>f.kind==='damage'&&f.reviewStatus!=='confirmed'&&f.reviewStatus!=='rejected').map(serialize),limitations:['Observations describe recorded views; unseen areas were not assessed.','A confirmed finding is a user-reviewed observation, not a determination of liability.',...(inspection.analysisWarnings||[])]};
  const download=new URL(request.url).searchParams.get('download')==='1';return Response.json(report,{headers:{'Cache-Control':'private, no-store',...(download?{'Content-Disposition':`attachment; filename="dwelld-${inspectionId}.json"`}:{})}});
 }catch(e){return errorResponse(e,'inspection.report')}
}
