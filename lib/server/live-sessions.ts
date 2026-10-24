import {sameDamage,damageEvidence,canonicalDamageFindings} from "../damage-identity";
import { batchSummaries } from "../live/batches";
import {canReadRoom} from "./space-access";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb, parseObjectId } from "./db";
import type { InspectionSession, LiveRole, LiveStatus, LiveObject, LiveFinding } from "@/lib/live/types";
export class LiveError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type SessionDoc = { _id: ObjectId; ownerId:string; type?:"move-in"|"move-out";baselineInspectionId?:ObjectId; videoHealth?:{fps:number;decoded:number;dropped:number;updatedAt:string}; analysisIssue?:{code:string;message:string;at:string}; nativeCapture?:boolean; nativePreview?:string; nativeProgress?:{stage:string;frames:number;depthFrames:number;upload?:number}; nativeLive?:import("../live/types").NativeLive; signalSequence?: number; roomId: ObjectId; desktopHash: string; pairingHash: string; phoneHash?: string; deviceId?: string; createdAt: Date; expiresAt: Date; pairingExpiresAt: Date; status: LiveStatus; phoneLastSeenAt?: Date; desktopLastSeenAt?: Date; stopRequested?: boolean; inspectionId?: ObjectId; continueFrom?: ObjectId; sourceUrl?: string; videoMimeType?: string; manualUntil?: Date; manualLeaseId?: string; analysisWarnings?:string[]; analysisInFlight?: boolean; analysisAfter?: Date };
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const validToken = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{32,128}$/.test(v);
export const validEventId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(v);
let liveIndexes:Promise<unknown>|undefined;
export async function liveCollections() {
 const db = await getDb(); const sessions = db.collection<SessionDoc>("liveSessions");
 if(!liveIndexes)liveIndexes=Promise.all([db.collection("liveSignals").createIndex({expiresAt:1},{expireAfterSeconds:0}),db.collection("liveSignals").createIndex({sessionId:1,eventId:1},{unique:true}),db.collection("liveAnalyses").createIndex({sessionId:1,observationId:1},{unique:true}),db.collection("liveEvidence").createIndex({sessionId:1,observationId:1},{unique:true}),db.collection("liveEvents").createIndex({sessionId:1,eventId:1},{unique:true}),db.collection("liveObjects").createIndex({sessionId:1,objectId:1},{unique:true}),db.collection("liveFindings").createIndex({sessionId:1,id:1},{unique:true}),db.collection("liveFrames").createIndex({sessionId:1,sampleSecond:1},{unique:true,partialFilterExpression:{sampleSecond:{$type:"number"}}}),db.collection("scanChat").createIndex({ownerId:1,contextId:1,createdAt:-1})]).catch(error=>{liveIndexes=undefined;throw error});
 await liveIndexes;
 return {db,sessions};
}
export function safeSession(s: SessionDoc): InspectionSession { return {id:String(s._id),type:s.type,baselineInspectionId:s.baselineInspectionId?String(s.baselineInspectionId):undefined,roomId:String(s.roomId),status:s.status,createdAt:s.createdAt.toISOString(),expiresAt:s.expiresAt.toISOString(),pairingExpiresAt:s.pairingExpiresAt.toISOString(),paired:!!s.phoneHash&&s.status!=="saved",analysisIssue:s.analysisIssue,nativeCapture:!!s.nativeCapture,nativePreview:s.nativePreview,nativeProgress:s.nativeProgress&&s.status==='saved'?{...s.nativeProgress,stage:'saved',upload:1}:s.nativeProgress,nativeLive:s.nativeLive,phoneLastSeenAt:s.phoneLastSeenAt?.toISOString(),desktopLastSeenAt:s.desktopLastSeenAt?.toISOString(),inspectionId:s.inspectionId?.toHexString(),continueFrom:s.continueFrom?.toHexString(),stopRequested:!!s.stopRequested}; }
/** Saved captures remain readable, but their phone connection cannot start more work. */
export function assertLiveRequestOpen(session: Pick<SessionDoc,'status'>, request: Request) {
 const acknowledgement = /\/api\/live\/[a-f0-9]{24}\/spatial$/.test(new URL(request.url).pathname) && ['PUT','POST'].includes(request.method);
 if (session.status === 'saved' && !['GET','HEAD'].includes(request.method) && !acknowledgement) throw new LiveError('This inspection is saved and its capture connection is closed. Pair a new inspection to scan again.',409);
}
export async function authenticateLive(request: Request,id: string,required?: LiveRole) {
 const oid=parseObjectId(id); const token=request.headers.get("authorization")?.replace(/^Bearer /,"") || "";
 if(!oid || !validToken(token)) throw new LiveError("Session authorization required",401);
 const {sessions}=await liveCollections(); const session=await sessions.findOne({_id:oid,expiresAt:{$gt:new Date()}});
 const hash=hashToken(token); const role:LiveRole|null=session?.desktopHash===hash?"desktop":session?.phoneHash===hash?"phone":null;
 if(!session || !role || (required && required!==role)) throw new LiveError("Session expired or access denied",403);
 assertLiveRequestOpen(session,request);
 await sessions.updateOne({_id:oid},{$set:{[role+"LastSeenAt"]:new Date()}});
 return {session,role};
}
export function iceServers(): RTCIceServer[] {
 const servers:RTCIceServer[]=[{urls:"stun:stun.l.google.com:19302"}];
 const urls=process.env.TURN_URLS?.split(",").map(v=>v.trim()).filter(v=>/^turns?:/.test(v));
 const secret=process.env.TURN_SHARED_SECRET;
 if(urls?.length && secret){const username=`${Math.floor(Date.now()/1000)+3600}:dwelld`;servers.push({urls,username,credential:createHmac("sha1",secret).update(username).digest("base64")});}
 // TURN REST secret never leaves the server; credentials expire after one hour.
 return servers;
}
export async function createLive(roomId:string, ownerId:string, type:"move-in"|"move-out"="move-in", continueFrom?:string,baselineId?:string) {
 if(!["move-in","move-out"].includes(type))throw new LiveError("Invalid inspection type");
 const id=parseObjectId(roomId); const {db,sessions}=await liveCollections();
 const room=id&&await db.collection("rooms").findOne({_id:id});
 if(!id || !room || !await canReadRoom(room as never,ownerId)) throw new LiveError("Room not found",404);
 // Continuing a scan: the phone relocalizes into the earlier scan's saved world map.
 let base:ObjectId|undefined;
 if(continueFrom!==undefined&&continueFrom!==null&&continueFrom!==""){
  base=parseObjectId(String(continueFrom))??undefined;
  const inspection=base&&await db.collection("inspections").findOne({_id:base,ownerId,roomId:id});
  if(!base||!inspection)throw new LiveError("Scan to continue not found",404);
  const capture=await db.collection("spatialCaptures").findOne({inspectionId:base,ownerId,"manifest.assets.kind":"worldmap"},{projection:{_id:1}});
  if(!capture)throw new LiveError("This scan was saved before resume support, so it can't be continued. Start a new scan.",409);
  type=inspection.type==="move-out"?"move-out":"move-in";
 }
 let selectedBaseline:ObjectId|undefined;
 if(baselineId&&typeof baselineId!=='string')throw new LiveError('Invalid check-in selection.');
 if(type==='move-out'&&baselineId){
  selectedBaseline=parseObjectId(baselineId)??undefined;
  const earlier=selectedBaseline&&await db.collection('inspections').findOne({_id:selectedBaseline,roomId:id,type:'move-in',status:{$in:['completed','partial']}});
  if(!earlier)throw new LiveError('Choose a finished check-in from this room.');
 }
 const desktopToken=randomBytes(32).toString("base64url"),pairingToken=randomBytes(32).toString("base64url"); const now=new Date();
 const session:SessionDoc={_id:new ObjectId(),ownerId,type,...(selectedBaseline?{baselineInspectionId:selectedBaseline}:{}),roomId:id,...(base?{continueFrom:base}:{}),desktopHash:hashToken(desktopToken),pairingHash:hashToken(pairingToken),createdAt:now,expiresAt:new Date(+now+2*3600000),pairingExpiresAt:new Date(+now+10*60000),status:"pairing"};
 await sessions.insertOne(session); return {sessionId:String(session._id),desktopToken,pairingToken,pairingExpiresAt:session.pairingExpiresAt.toISOString(),expiresAt:session.expiresAt.toISOString(),iceServers:iceServers()};
}
export function liveFailure(error:unknown) { const requestId=randomUUID(); const status=error instanceof LiveError?error.status:error instanceof SyntaxError?400:500; if(status>=500) console.error("Live request failed",{requestId,name:error instanceof Error?error.name:"Error"}); return Response.json({error:error instanceof LiveError?error.message:status===400?"Invalid request body":"Live inspection request failed; retry shortly",requestId},{status,headers:{"Cache-Control":"no-store"}}); }
export async function recordLiveAnalysis(session:SessionDoc,observationId:string,result:{evidenceFrameRef:string;findings:LiveFinding[]}) {
 const {db}=await liveCollections();
 await db.collection("liveEvidence").updateOne({sessionId:session._id,observationId},{$setOnInsert:{sessionId:session._id,observationId,ref:result.evidenceFrameRef,createdAt:new Date()}},{upsert:true});
 const existing=await db.collection('liveFindings').find({sessionId:session._id,kind:'damage',source:{$ne:'manual'}}).toArray();
 for(const [index,finding] of result.findings.entries()){
  const candidate={...finding,kind:'damage',evidenceFrameUrl:result.evidenceFrameRef};const duplicate=existing.find(p=>sameDamage(p,candidate));
  if(duplicate){await db.collection('liveFindings').updateOne({sessionId:session._id,id:duplicate.id},{$addToSet:{evidenceObservations:{$each:[damageEvidence(duplicate),damageEvidence(candidate)]}}});continue;}
  const id=finding.id||`${observationId}-${index}`;
  const doc={...finding,id,sessionId:session._id,kind:'damage',evidenceFrameRef:result.evidenceFrameRef,evidenceObservations:[damageEvidence(candidate)],reviewStatus:'pending',createdAt:new Date(),reviewHistory:[]};
  await db.collection('liveFindings').updateOne({sessionId:session._id,id},{$setOnInsert:doc},{upsert:true});existing.push(doc as never);
 }

}
export async function getLiveState(session:SessionDoc,role:LiveRole,_after:string|null) {
 const {db}=await liveCollections();
 const [objects,findings,signals]=await Promise.all([db.collection("liveObjects").find({sessionId:session._id},{projection:{_id:0,sessionId:0}}).limit(100).toArray(),db.collection("liveFindings").find({sessionId:session._id},{projection:{_id:0,sessionId:0}}).sort({timestampSeconds:-1,createdAt:-1}).limit(200).toArray(),db.collection("liveSignals").find({sessionId:session._id,to:role}).sort({sequence:-1,createdAt:-1,_id:-1}).limit(200).toArray()]);
 const [progress,batchFrames]=await Promise.all([liveFrameProgress(session._id),db.collection('liveFrames').find({sessionId:session._id},{projection:{name:1,ref:1,timestampSeconds:1,status:1,batchId:1,workerSlot:1,attempt:1,retryMessage:1,error:1,findings:1,findingIds:1,newFindingIds:1,observations:1,objects:1,views:1,warnings:1}}).sort({timestampSeconds:-1}).limit(121).toArray()]);
 const record=session.inspectionId?await db.collection('inspections').findOne({_id:session.inspectionId},{projection:{analysisStartedAt:1,completedAt:1,status:1,scanReportStatus:1,scanReportError:1,reportComparisonStatus:1,reportComparisonError:1,searchIndexStatus:1,searchIndexError:1}}):null;
 const began=record?.analysisStartedAt||record?.completedAt;
 if(session.status==='saved'&&record?.status==='processing'&&began&&new Date(began).getTime()<Date.now()-360_000){
  const updates={status:'partial',...(record.scanReportStatus!=='ready'?{scanReportStatus:'failed',scanReportError:'The report worker stopped before completion. Saved sources remain available.'}:{}),...(!['ready','partial'].includes(record.searchIndexStatus)?{searchIndexStatus:'failed',searchIndexError:'Search preparation was interrupted. Saved sources remain available.'}:{})};
  const recovered=await db.collection('inspections').updateOne({_id:session.inspectionId,status:'processing',analysisStartedAt:record.analysisStartedAt},{$set:updates});
  if(recovered.modifiedCount){Object.assign(record,updates);await db.collection('liveFrames').updateMany({sessionId:session._id,status:{$in:['queued','analyzing']}},{$set:{status:'failed',error:'The processing worker stopped before completion. This source has not been assessed.',errorCode:'AI_UNAVAILABLE'}});
   for(const frame of batchFrames)if(frame.status==='queued'||frame.status==='analyzing'){frame.status='failed';frame.error='The processing worker stopped before completion. Source retained.';}
   progress.failed+=progress.queued+progress.checking;progress.queued=0;progress.checking=0;
  }
 }
 return {session:{...safeSession(session),workflow:record?{inspectionStatus:record.status,reportStatus:record.scanReportStatus,reportError:record.scanReportError,comparisonStatus:record.reportComparisonStatus,comparisonError:record.reportComparisonError,searchStatus:record.searchIndexStatus,searchError:record.searchIndexError}:undefined,analysisProgress:progress,analysisBatches:batchSummaries(batchFrames as never)},objects:objects as unknown as LiveObject[],findings:canonicalDamageFindings(findings),signals:signals.reverse().map(s=>({id:String(s._id),eventId:s.eventId,type:s.type,data:s.data,from:s.from}))};
}

export async function liveFrameProgress(sessionId: ObjectId) {
 const {db} = await liveCollections();
 const counts = await db.collection('liveFrames').aggregate<{_id:string;count:number}>([{ $match: {sessionId} }, { $group: {_id:'$status',count:{$sum:1}} }]).toArray();
 const count = (status:string) => counts.find(c=>c._id===status)?.count || 0;
 return { checked:count('done'),checking:count('analyzing'),queued:count('queued'),failed:count('failed') };
}
