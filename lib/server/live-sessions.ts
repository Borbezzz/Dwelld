import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb, parseObjectId } from "./db";
import type { InspectionSession, LiveRole, LiveStatus, LiveObject, LiveFinding } from "@/lib/live/types";
export class LiveError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type SessionDoc = { _id: ObjectId; ownerId:string; type?:"move-in"|"move-out"; nativeCapture?:boolean; nativePreview?:string; nativeProgress?:{stage:string;frames:number;depthFrames:number;upload?:number}; nativeLive?:import("../live/types").NativeLive; signalSequence?: number; roomId: ObjectId; desktopHash: string; pairingHash: string; phoneHash?: string; deviceId?: string; createdAt: Date; expiresAt: Date; pairingExpiresAt: Date; status: LiveStatus; phoneLastSeenAt?: Date; desktopLastSeenAt?: Date; stopRequested?: boolean; inspectionId?: ObjectId; sourceUrl?: string; videoMimeType?: string; manualUntil?: Date; manualLeaseId?: string; analysisWarnings?:string[]; analysisInFlight?: boolean; analysisAfter?: Date };
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const validToken = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{32,128}$/.test(v);
export const validEventId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(v);
export async function liveCollections() {
 const db = await getDb(); const sessions = db.collection<SessionDoc>("liveSessions");
 await Promise.all([db.collection("liveSignals").createIndex({expiresAt:1},{expireAfterSeconds:0}),db.collection("liveSignals").createIndex({sessionId:1,eventId:1},{unique:true}),db.collection("liveAnalyses").createIndex({sessionId:1,observationId:1},{unique:true}),db.collection("liveEvidence").createIndex({sessionId:1,observationId:1},{unique:true}),db.collection("liveEvents").createIndex({sessionId:1,eventId:1},{unique:true}),db.collection("liveObjects").createIndex({sessionId:1,objectId:1},{unique:true}),db.collection("liveFindings").createIndex({sessionId:1,id:1},{unique:true})]);
 return {db,sessions};
}
export function safeSession(s: SessionDoc): InspectionSession { return {id:String(s._id),roomId:String(s.roomId),status:s.status,createdAt:s.createdAt.toISOString(),expiresAt:s.expiresAt.toISOString(),pairingExpiresAt:s.pairingExpiresAt.toISOString(),paired:!!s.phoneHash,nativeCapture:!!s.nativeCapture,nativePreview:s.nativePreview,nativeProgress:s.nativeProgress,nativeLive:s.nativeLive,phoneLastSeenAt:s.phoneLastSeenAt?.toISOString(),desktopLastSeenAt:s.desktopLastSeenAt?.toISOString(),inspectionId:s.inspectionId?.toHexString(),stopRequested:!!s.stopRequested}; }
export async function authenticateLive(request: Request,id: string,required?: LiveRole) {
 const oid=parseObjectId(id); const token=request.headers.get("authorization")?.replace(/^Bearer /,"") || "";
 if(!oid || !validToken(token)) throw new LiveError("Session authorization required",401);
 const {sessions}=await liveCollections(); const session=await sessions.findOne({_id:oid,expiresAt:{$gt:new Date()}});
 const hash=hashToken(token); const role:LiveRole|null=session?.desktopHash===hash?"desktop":session?.phoneHash===hash?"phone":null;
 if(!session || !role || (required && required!==role)) throw new LiveError("Session expired or access denied",403);
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
export async function createLive(roomId:string, ownerId:string, type:"move-in"|"move-out"="move-in") {
 if(!["move-in","move-out"].includes(type))throw new LiveError("Invalid inspection type");
 const id=parseObjectId(roomId); const {db,sessions}=await liveCollections();
 if(!id || !await db.collection("rooms").findOne({_id:id,ownerId})) throw new LiveError("Room not found",404);
 const desktopToken=randomBytes(32).toString("base64url"),pairingToken=randomBytes(32).toString("base64url"); const now=new Date();
 const session:SessionDoc={_id:new ObjectId(),ownerId,type,roomId:id,desktopHash:hashToken(desktopToken),pairingHash:hashToken(pairingToken),createdAt:now,expiresAt:new Date(+now+2*3600000),pairingExpiresAt:new Date(+now+10*60000),status:"pairing"};
 await sessions.insertOne(session); return {sessionId:String(session._id),desktopToken,pairingToken,pairingExpiresAt:session.pairingExpiresAt.toISOString(),expiresAt:session.expiresAt.toISOString(),iceServers:iceServers()};
}
export function liveFailure(error:unknown) { const requestId=randomUUID(); const status=error instanceof LiveError?error.status:error instanceof SyntaxError?400:500; if(status>=500) console.error("Live request failed",{requestId,name:error instanceof Error?error.name:"Error"}); return Response.json({error:error instanceof LiveError?error.message:status===400?"Invalid request body":"Live inspection request failed; retry shortly",requestId},{status,headers:{"Cache-Control":"no-store"}}); }
export async function recordLiveAnalysis(session:SessionDoc,observationId:string,result:{evidenceFrameRef:string;findings:LiveFinding[]}) {
 const {db}=await liveCollections();
 await db.collection("liveEvidence").updateOne({sessionId:session._id,observationId},{$setOnInsert:{sessionId:session._id,observationId,ref:result.evidenceFrameRef,createdAt:new Date()}},{upsert:true});
 for(const [index,finding] of result.findings.entries()) {const id=finding.id || `${observationId}-${index}`;await db.collection("liveFindings").updateOne({sessionId:session._id,id},{$setOnInsert:{...finding,id,sessionId:session._id,evidenceFrameRef:result.evidenceFrameRef,reviewStatus:"pending",createdAt:new Date(),reviewHistory:[]}},{upsert:true});}
}
export async function getLiveState(session:SessionDoc,role:LiveRole,_after:string|null) {
 const {db}=await liveCollections();
 const [objects,findings,signals]=await Promise.all([db.collection("liveObjects").find({sessionId:session._id},{projection:{_id:0,sessionId:0}}).limit(100).toArray(),db.collection("liveFindings").find({sessionId:session._id},{projection:{_id:0,sessionId:0}}).limit(200).toArray(),db.collection("liveSignals").find({sessionId:session._id,to:role}).sort({sequence:-1,createdAt:-1,_id:-1}).limit(200).toArray()]);
 return {session:safeSession(session),objects:objects as unknown as LiveObject[],findings,signals:signals.reverse().map(s=>({id:String(s._id),eventId:s.eventId,type:s.type,data:s.data,from:s.from}))};
}
