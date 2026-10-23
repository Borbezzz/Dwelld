import {parseObjectId} from "@/lib/server/db";
import {liveCollections,hashToken,validToken,LiveError,liveFailure,safeSession,iceServers} from "@/lib/server/live-sessions";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {sessionId}=await params;const id=parseObjectId(sessionId);const b=await request.json();if(!id||!validToken(b.pairingToken)||!validToken(b.phoneToken)||!validToken(b.deviceId))throw new LiveError("Invalid pairing request");
 const {sessions}=await liveCollections(); const phoneHash=hashToken(b.phoneToken);
 const retry=await sessions.findOne({_id:id,phoneHash,deviceId:b.deviceId,expiresAt:{$gt:new Date()}});
 if(retry)return Response.json({phoneToken:b.phoneToken,session:safeSession(retry),iceServers:iceServers()},{headers:{"Cache-Control":"no-store"}});
 const session=await sessions.findOneAndUpdate({_id:id,pairingHash:hashToken(b.pairingToken),pairingExpiresAt:{$gt:new Date()},expiresAt:{$gt:new Date()},phoneHash:{$exists:false}},{$set:{phoneHash,deviceId:b.deviceId,phoneLastSeenAt:new Date(),status:"connected"}},{returnDocument:"after"});
 if(!session)throw new LiveError("Pairing expired or another phone has already paired",409);
 return Response.json({phoneToken:b.phoneToken,session:safeSession(session),iceServers:iceServers()},{headers:{"Cache-Control":"no-store"}});
}catch(e){return liveFailure(e);}}
