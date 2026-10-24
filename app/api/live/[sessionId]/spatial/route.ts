import {after} from 'next/server';
import {authenticateLive,liveFrameProgress,liveCollections,liveFailure,LiveError} from '@/lib/server/live-sessions';
import {readJsonBody} from '@/lib/server/request-body';
import {validateManifest} from '@/lib/server/spatial';
import {getMediaFile} from '@/lib/server/media';
import {analyzeNativeInspection} from '@/lib/server/native-analysis';
import {importPhoneMarks,validElements,validPose,validSplat} from '@/lib/server/native-live';
import {saveContinuation} from '@/lib/server/continuation';
export const runtime='nodejs';export const maxDuration=300;
type Context={params:Promise<{sessionId:string}>};
export async function PUT(request:Request,{params}:Context){try{const {session}=await authenticateLive(request,(await params).sessionId,'phone');if(session.status==='saved')return Response.json({saved:true});const b=await readJsonBody(request,400*1024);if(!['ready','scanning','processing','uploading'].includes(b.stage)||!Number.isInteger(b.frames)||b.frames<0||b.frames>600||!Number.isInteger(b.depthFrames)||b.depthFrames<0||b.depthFrames>b.frames)throw new LiveError('Invalid scan progress');if(b.preview!==undefined&&(typeof b.preview!=='string'||b.preview.length>180000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.preview)))throw new LiveError('Invalid preview');
 const upload=typeof b.upload==='number'&&b.upload>=0&&b.upload<=1?b.upload:undefined;
 const pose=validPose(b.pose),elements=b.elements===undefined?undefined:validElements(b.elements),splat=b.splat===undefined?undefined:validSplat(b.splat);
 const live={...(session.nativeLive||{}),...(splat!==undefined?{splat}:{}),...(elements?{elements}:{}),...(b.preview&&pose?{pose}:{}),updatedAt:new Date().toISOString()};
 const {sessions}=await liveCollections();await sessions.updateOne({_id:session._id,status:{$ne:'saved'}},{$set:{nativeCapture:true,...(b.preview?{nativePreview:b.preview}:{}),nativeProgress:{stage:b.stage,frames:b.frames,depthFrames:b.depthFrames,...(upload!==undefined?{upload}:{})},nativeLive:live,status:b.stage==='scanning'?'recording':'connected'}});
 const {db}=await liveCollections();
 const [findings,analysisProgress]=await Promise.all([db.collection('liveFindings').find({sessionId:session._id,reviewStatus:{$ne:'rejected'}},{projection:{_id:0,id:1,label:1,worldPosition:1,boundingBox:1,evidenceFrameRef:1,reviewStatus:1,timestampSeconds:1}}).sort({timestampSeconds:-1}).limit(80).toArray(),liveFrameProgress(session._id)]);
 return Response.json({stopRequested:!!session.stopRequested,findings,analysisProgress,analysisIssue:session.analysisIssue});}catch(e){return liveFailure(e)}}
export async function POST(request:Request,{params}:Context){try{const {session}=await authenticateLive(request,(await params).sessionId,'phone');const {db,sessions}=await liveCollections();const manifest=validateManifest(await readJsonBody(request,2*1024*1024));const inspectionId=session.inspectionId||session._id;
 for(const asset of manifest.assets){const file=await getMediaFile(asset.mediaRef);if(file?.metadata?.ownerId!==session.ownerId||file.metadata.liveSessionId!==String(session._id))throw new LiveError('Asset does not belong to this paired scan',403);}
 if(session.continueFrom){
  // A continued scan is folded into the earlier inspection, in its coordinates.
  const {analysis,inspection}=await saveContinuation(session,manifest);
  if(analysis)after(()=>analyzeNativeInspection(inspection,analysis.manifest,session._id,{objectElementIds:analysis.objectElementIds}));
  await importPhoneMarks(session,session.continueFrom,manifest).catch(e=>console.error('phone marks import failed',e instanceof Error?e.message:e));
  await sessions.updateOne({_id:session._id},{$set:{nativeCapture:true,status:'saved',inspectionId:session.continueFrom,nativeProgress:{...session.nativeProgress,stage:'saved',upload:1,frames:session.nativeProgress?.frames??manifest.frames.length,depthFrames:session.nativeProgress?.depthFrames??manifest.frames.filter(f=>f.depth).length}}});
  return Response.json({saved:true,inspectionId:String(session.continueFrom)});
 }
 await db.collection('spatialCaptures').createIndex({inspectionId:1},{unique:true});const existing=await db.collection('spatialCaptures').findOne({inspectionId});if(existing&&JSON.stringify(existing.manifest)!==JSON.stringify(manifest))throw new LiveError('This session already contains a different scan',409);
 if(!existing){await db.collection('inspections').updateOne({_id:inspectionId},{$setOnInsert:{ownerId:session.ownerId,roomId:session.roomId,type:session.type||'move-in',captureSource:'native-lidar',status:'processing',createdAt:new Date()}},{upsert:true});await db.collection('spatialCaptures').insertOne({inspectionId,ownerId:session.ownerId,roomId:session.roomId,manifest,createdAt:new Date()});const inspection=await db.collection('inspections').findOne({_id:inspectionId});if(inspection)after(()=>analyzeNativeInspection(inspection,manifest,session._id));}
 await importPhoneMarks(session,inspectionId,manifest).catch(e=>console.error('phone marks import failed',e instanceof Error?e.message:e));
 await sessions.updateOne({_id:session._id},{$set:{nativeCapture:true,status:'saved',inspectionId,nativeProgress:{...session.nativeProgress,stage:'saved',upload:1,frames:session.nativeProgress?.frames??manifest.frames.length,depthFrames:session.nativeProgress?.depthFrames??manifest.frames.filter(f=>f.depth).length}}});return Response.json({saved:true,inspectionId:String(inspectionId)});
 }catch(e){return liveFailure(e)}}
