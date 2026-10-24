import {logAIFailure} from '@/lib/server/analysis-failure';
import {errorResponse} from '@/lib/server/api-error';
import {requireUser} from '@/lib/server/access';
import {requireReadableInspection} from '@/lib/server/space-access';
import {authenticateLive,validEventId,LiveError,liveFailure} from '@/lib/server/live-sessions';
import {getDb,parseObjectId} from '@/lib/server/db';
import {readJsonBody} from '@/lib/server/request-body';
import {answerScanQuestion,type ChatSource} from '@/lib/server/scan-chat';
export const runtime='nodejs';export const maxDuration=90;
let indexes:Promise<unknown>|undefined;
async function context(request:Request,body:Record<string,unknown>){
 if(typeof body.sessionId==='string'){
  const {session}=await authenticateLive(request,body.sessionId);
  return {db:await getDb(),ownerId:session.ownerId,contextId:`live:${session._id}`,live:session._id,inspectionId:null,savedLiveId:null};
 }
 const id=typeof body.inspectionId==='string'?parseObjectId(body.inspectionId):null;if(!id)throw new LiveError('Choose the current scan');
 const user=await requireUser(request);const inspection=await requireReadableInspection(id,user.id);
 return {db:await getDb(),ownerId:user.id,contextId:`inspection:${id}`,live:null,inspectionId:id,savedLiveId:inspection.liveSessionId};
}
export async function POST(request:Request){try{
 const body=await readJsonBody(request,8192);
 if(typeof body.question!=='string'||body.question.trim().length<2||body.question.length>1000||!validEventId(body.requestId))throw new LiveError('Ask a question of 2–1000 characters');
 const c=await context(request,body),turns=c.db.collection('scanChat'),scope={ownerId:c.ownerId,contextId:c.contextId};
 if(!indexes)indexes=Promise.all([turns.createIndex({ownerId:1,contextId:1,requestId:1},{unique:true}),turns.createIndex({ownerId:1,contextId:1,createdAt:-1})]).catch(e=>{indexes=undefined;throw e});await indexes;
 const existing=await turns.findOne({...scope,requestId:body.requestId});if(existing)return Response.json({answer:existing.answer,sources:existing.sources,warnings:existing.warnings,model:existing.model});
 if(await turns.countDocuments({...scope,createdAt:{$gte:new Date(Date.now()-60000)}})>=10)throw new LiveError("Please wait a moment before asking another question",429);
 const [history,findings,frames]=await Promise.all([
  turns.find(scope).sort({createdAt:-1}).limit(6).toArray(),
  c.db.collection(c.live?'liveFindings':'findings').find(c.live?{sessionId:c.live}:{inspectionId:c.inspectionId}).sort({timestampSeconds:-1}).limit(80).toArray(),
  c.live?c.db.collection('liveFrames').find({sessionId:c.live}).sort({timestampSeconds:-1}).limit(3).toArray():c.db.collection('spatialCaptures').findOne({inspectionId:c.inspectionId}).then(async capture=>{const m=capture?.manifest;return m?m.frames.slice(-3).map((f:{image:string;timestamp:number})=>({timestampSeconds:f.timestamp,ref:m.assets.find((a:{name:string;mediaRef:string})=>a.name===f.image)?.mediaRef})):c.savedLiveId?c.db.collection('liveFrames').find({sessionId:c.savedLiveId}).sort({timestampSeconds:-1}).limit(3).toArray():[]}),
 ]);
 if(typeof body.findingId==='string'){
  const index=findings.findIndex(f=>String(f.id||f._id)===body.findingId);
  if(index>0)findings.unshift(findings.splice(index,1)[0]);
  else if(index<0){const selectedId=c.live?body.findingId:parseObjectId(body.findingId);if(selectedId){const selected=await c.db.collection(c.live?'liveFindings':'findings').findOne(c.live?{sessionId:c.live,id:selectedId}:{inspectionId:c.inspectionId,_id:selectedId});if(selected)findings.unshift(selected);}}
 }
 const sources:ChatSource[]=[...findings.map((f,i)=>({id:`F${i+1}`,findingId:String(f.id||f._id),label:f.label,description:f.description,userNote:f.userNote,reviewStatus:f.reviewStatus||'pending',point:f.point,boundingBox:f.boundingBox,timestamp:f.timestampSeconds,imageRef:f.evidenceFrameRef||f.evidenceFrameUrl})),...frames.map((f:{timestampSeconds:number;ref?:string},i:number)=>({id:`I${i+1}`,label:'Camera snapshot',timestamp:f.timestampSeconds,imageRef:f.ref}))];
 const result=await answerScanQuestion(body.question.trim(),sources,history.reverse());
 try{await turns.insertOne({...scope,requestId:body.requestId,question:body.question.trim(),...result,createdAt:new Date()})}catch(error){if((error as {code?:number}).code!==11000)throw error;const cached=await turns.findOne({...scope,requestId:body.requestId});if(cached)return Response.json({answer:cached.answer,sources:cached.sources,warnings:cached.warnings,model:cached.model});}
 return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
}catch(error){if(!(error instanceof LiveError))logAIFailure("scan.chat",error);return error instanceof LiveError?liveFailure(error):errorResponse(error,"scan.chat")}}
