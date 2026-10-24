import {groupedReportFlags} from "@/lib/server/comparison-dedup";
import {groupedDamage} from "@/lib/server/damage-groups";
import {canReadRoom,requireReadableInspection} from '@/lib/server/space-access';
import { getDb, parseObjectId } from '@/lib/server/db';
import { requireUser } from '@/lib/server/access';
import { errorResponse } from '@/lib/server/api-error';
import { objectCaptureSignature } from '@/lib/server/object-capture-signature';
import { isFurniture } from '@/lib/spatial/furniture';
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
  const rawFindings=await db.collection('findings').find({inspectionId:id,reportEntry:{$ne:true},...(segment?{timestampSeconds:{$gte:segment.startTime,$lt:segment.endTime}}:{})}).sort({timestampSeconds:1,createdAt:1}).toArray();
  const findings=await groupedDamage(db,id,rawFindings);
  const capture=await db.collection('spatialCaptures').findOne({inspectionId:id},{projection:{manifest:1}});
  const rebuilt=await db.collection('objectReconstructions').find({inspectionId:id,method:'multiview-depth-v1',captureSignature:capture?.manifest?objectCaptureSignature(capture.manifest):'',unavailable:{$ne:true}},{projection:{elementId:1,measurements:1,measuredAxes:1,views:1,points:1}}).toArray();
  const rebuiltById=new Map(rebuilt.map(item=>[item.elementId,item]));
  const measurements=(capture?.manifest?.elements||[]).filter((e: {category?: string})=>isFurniture(e as never)).map((e: {id: string; category: string; dimensions: number[]})=>{const cloud=rebuiltById.get(e.id);return {elementId:e.id,category:e.category,dimensionsMetres:cloud?.measurements?[cloud.measurements.width,cloud.measurements.height,cloud.measurements.depth]:e.dimensions,scanDimensionsMetres:e.dimensions,measuredFromPhotos:cloud?.measuredAxes||[false,false,false],photoViews:cloud?.views||0,reconstructedPoints:cloud?.points||0};});
  const currentDimensions = new Map(measurements.map((m: {elementId:string;dimensionsMetres:number[]}) => [m.elementId, m.dimensionsMetres]));
  const serialize=(f:typeof findings[number])=>({evidenceObservations:f.evidenceObservations,sourceObservationIds:f.sourceObservationIds,id:String(f._id),kind:f.kind,label:f.label,description:f.description||'',reviewStatus:f.reviewStatus||'pending',timestampSeconds:f.timestampSeconds??null,point:f.point??null,boundingBox:f.boundingBox??null,dimensionsMetres:f.kind==='object'&&currentDimensions.has(f.spatialElementId)?currentDimensions.get(f.spatialElementId):Array.isArray(f.dimensions)?f.dimensions:null,spatialElementId:f.spatialElementId||null,evidenceFrameUrl:f.evidenceFrameUrl?`/api/media?url=${encodeURIComponent(f.evidenceFrameUrl)}`:null,source:f.source||'ai',detectionSource:f.detectionSource||null,objectId:f.objectId?String(f.objectId):null});
  const report={schemaVersion:3,scanReportStatus:segment?null:inspection.scanReportStatus??null,scanReportError:segment?null:inspection.scanReportError??null,scanReport:segment?null:inspection.scanReport??null,reportComparison:segment?null:await groupedReportFlags(db,inspection.reportComparison),generatedAt:new Date().toISOString(),inspection:{id:inspectionId,roomId:String(target),roomName:room?.name||'Room',createdAt:inspection.createdAt,status:inspection.status,type:inspection.type||"move-in",scanReportStatus:inspection.scanReportStatus,reportComparisonStatus:inspection.reportComparisonStatus,reportComparison:inspection.reportComparison,baselineInspectionId:inspection.baselineInspectionId?String(inspection.baselineInspectionId):undefined,searchIndexStatus:inspection.searchIndexStatus,searchIndexError:inspection.searchIndexError,analysisProgress:inspection.analysisProgress,analysisWarnings:inspection.analysisWarnings,framesAnalysed:inspection.framesAnalysed,durationSeconds:inspection.durationSeconds??null,videoUrl:typeof inspection.sourceUrl==='string'?`/api/inspections/${inspectionId}/video`:null,videoStoredInMongo:typeof inspection.sourceUrl==='string'},measurements,inventory:findings.filter(f=>f.kind==='object'&&f.reviewStatus!=='rejected').map(serialize),confirmedDamage:findings.filter(f=>f.kind==='damage'&&f.reviewStatus==='confirmed').map(serialize),pendingDamage:findings.filter(f=>f.kind==='damage'&&f.reviewStatus!=='confirmed'&&f.reviewStatus!=='rejected').map(serialize),limitations:['Observations describe recorded views; unseen areas were not assessed.','A confirmed finding is a user-reviewed observation, not a determination of liability.',...(inspection.analysisWarnings||[])]};
  await db.collection('inspectionReports').updateOne({inspectionId:id,roomId:target},{$set:{ownerId:inspection.ownerId,report,updatedAt:new Date()}},{upsert:true}).catch(()=>{});
  const download=new URL(request.url).searchParams.get('download')==='1';return Response.json(report,{headers:{'Cache-Control':'private, no-store',...(download?{'Content-Disposition':`attachment; filename="dwelld-${inspectionId}.json"`}:{})}});
 }catch(e){return errorResponse(e,'inspection.report')}
}
