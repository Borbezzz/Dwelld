import {ObjectId,type Document} from 'mongodb';
import {createHash} from 'node:crypto';
import {normalizeSpatialImage} from './spatial-image';
export {normalizeSpatialImage} from './spatial-image';
import {getDb} from './db';
import {readMedia} from './media';
import {detectImageObjects} from './yolo';
import {analyzeLiveFrame} from './live-analysis';
import {indexFindings} from './search';
import {boxDepthPoints,associateElement,objectIdentityKey,insideElement} from '../spatial/identity';
import type {SpatialManifest,Vec3,SpatialElement} from '../spatial/types';
export {worldPoint} from '../spatial/identity';
export async function analyzeSpatialInspection(inspection:Document,manifest:SpatialManifest){
 const db=await getDb(),warnings:string[]=['Sampled images and LiDAR geometry do not establish complete coverage. Confirm all AI observations.'];
 const deadline=Date.now()+230000;let success=0,unresolved=0;
 try{
  await db.collection('inspections').updateOne({_id:inspection._id},{$set:{status:'processing'}});
  const frames=[...new Set([0,Math.floor(manifest.frames.length/2),manifest.frames.length-1])].filter(i=>i>=0).map(i=>manifest.frames[i]).filter(Boolean);
  for(const [index,frame]of frames.entries()){
   if(Date.now()>deadline-45000){warnings.push('Remaining source frames were not analyzed because the time budget was reached.');break;}
   try{
    const asset=manifest.assets.find(a=>a.name===frame.image&&a.kind==='image');if(!asset)continue;
    const normalized=await normalizeSpatialImage(await readMedia(asset.mediaRef,20*1024*1024));
    const detections=(await detectImageObjects(normalized.image)).slice(0,20);
    let depth:Buffer|undefined,confidence:Buffer|undefined;
    const depthAsset=manifest.assets.find(a=>a.name===frame.depth&&a.kind==='depth'),confidenceAsset=manifest.assets.find(a=>a.name===frame.confidence&&a.kind==='confidence');
    if(depthAsset&&confidenceAsset&&normalized.width===frame.width&&normalized.height===frame.height){
     try{[depth,confidence]=await Promise.all([readMedia(depthAsset.mediaRef,8*1024*1024),readMedia(confidenceAsset.mediaRef,2*1024*1024)]);}catch{warnings.push(`Camera sample ${index+1} has unavailable depth or confidence data; objects remain unassociated.`);}
    }
    const identities=new Map<string,{id:ObjectId;element:SpatialElement|null;position:Vec3|null}>();
    for(const d of detections){
     const points=depth&&confidence?boxDepthPoints(d.boundingBox,frame,depth,confidence,normalized.orientation):[];
     const element=associateElement(d.label,d.confidence,points,manifest.elements);
     const key=element?objectIdentityKey(String(inspection._id),manifest.sessionId,element.id):`${inspection._id}:${frame.image}:${d.objectId}`;
     const id=new ObjectId(createHash('sha256').update(key).digest('hex').slice(0,24));
     identities.set(d.objectId,{id,element,position:points[0]||null});if(!element)unresolved++;
    }
    // At most 3 crops plus surface analysis; additional detections are inventory observations only.
    const observationId=new ObjectId().toHexString();const analysis=await analyzeLiveFrame(normalized.image,{sessionId:String(inspection._id),observationId,timestampSeconds:frame.timestamp,objects:detections.slice(0,3),includeSurfaces:true});
    warnings.push(...(analysis.analysisWarnings||[]));
    const base={inspectionId:inspection._id,roomId:inspection.roomId,ownerId:inspection.ownerId,evidenceFrameUrl:analysis.evidenceFrameRef,timestampSeconds:frame.timestamp,createdAt:new Date()};
    const markers:{findingId:string;position:Vec3;label:string;elementId:string|null}[]=[];
    const storedThisFrame=new Set<string>();
    for(const d of detections){
     const identity=identities.get(d.objectId)!;if(storedThisFrame.has(String(identity.id)))continue;storedThisFrame.add(String(identity.id));
     const observation={frame:frame.image,originalImageRef:asset.mediaRef,evidenceFrameUrl:analysis.evidenceFrameRef,timestampSeconds:frame.timestamp,boundingBox:d.boundingBox,confidence:d.confidence,position:identity.position};
     const doc={...base,kind:'object',label:d.label,boundingBox:d.boundingBox,confidence:d.confidence,detectionSource:'yolo',source:'ai',spatialSessionId:manifest.sessionId,spatialElementId:identity.element?.id||null,identityStatus:identity.element?'geometry-associated':'unresolved',description:identity.element?'Observation grouped with the same measured, category-compatible RoomPlan element within this scan. Review the association.':'Unassociated native-frame observation; it may repeat an item seen in another frame.'};
     // One canonical inventory document per confidently associated measured element, retaining every source observation.
     await db.collection('findings').updateOne({_id:identity.id},[{$set:{...Object.fromEntries(Object.entries(doc).map(([k,v])=>[k,{$literal:v}])),reviewStatus:{$ifNull:['$reviewStatus','pending']},reviewHistory:{$ifNull:['$reviewHistory',[]]},observations:{$concatArrays:[{$ifNull:['$observations',[]]},{$literal:[observation]}]}}}],{upsert:true});
     if(identity.position)markers.push({findingId:String(identity.id),position:identity.position,label:d.label,elementId:identity.element?.id||null});
    }
    for(const f of analysis.findings){
     const parent=f.parentObjectId?identities.get(f.parentObjectId):undefined;
     const id=new ObjectId();await db.collection('findings').insertOne({...base,_id:id,kind:'damage',label:f.label,description:f.description,boundingBox:f.boundingBox,objectId:parent?.id||null,detectionSource:f.detectionSource||'gemini',source:'ai',reviewStatus:'pending',reviewHistory:[]});
     const points=f.boundingBox&&depth&&confidence?boxDepthPoints(f.boundingBox,frame,depth,confidence,normalized.orientation):[];
     if(points.length){const position=points[0];markers.push({findingId:String(id),position,label:f.label,elementId:parent?.element&&insideElement(position,parent.element)?parent.element.id:null});}
    }
    for(const marker of markers){
     // Preserve user edits and one anchor per canonical object, rather than creating duplicate markers in every frame.
     await db.collection('spatialMarkers').updateOne({inspectionId:inspection._id,findingId:marker.findingId},{$setOnInsert:{...marker,inspectionId:inspection._id,ownerId:inspection.ownerId,sessionId:manifest.sessionId,reviewStatus:'pending',version:1,source:'high-confidence-depth-projection',createdAt:new Date(),reviewHistory:[{action:'projected',frame:frame.image,at:new Date()}]}},{upsert:true});
    }
    success++;
   }catch{warnings.push(`Camera sample ${index+1} could not be fully analyzed. Its original capture remains available.`);}
  }
  if(unresolved)warnings.push(`${unresolved} object observations could not be safely associated with a measured element; these may contain repeated views of the same item. Review before counting unique inventory.`);
  if(!frames.length)warnings.push('No camera frames were captured; only measured geometry is available.');
  await db.collection('inspections').updateOne({_id:inspection._id},{$set:{status:success===frames.length&&warnings.length===1?'completed':'partial',analysisWarnings:[...new Set(warnings)],completedAt:new Date(),durationSeconds:manifest.frames.at(-1)?.timestamp||0}});
  await indexFindings(inspection.ownerId,inspection._id).catch(()=>{});
 }catch{await db.collection('inspections').updateOne({_id:inspection._id},{$set:{status:'partial',analysisWarnings:[...warnings,'Spatial analysis did not finish. Original capture is preserved.']}});}
}
