import {validSignalPayload} from '@/lib/client/live-signaling';
import {authenticateLive,liveCollections,liveFailure,LiveError,validEventId} from "@/lib/server/live-sessions";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{const {sessionId}=await params;const {session,role}=await authenticateLive(request,sessionId);const b=await request.json();if(!validEventId(b.eventId)||!["offer","answer","ice","restart"].includes(b.type)||JSON.stringify(b.data??null).length>50000)throw new LiveError("Invalid signalling message");if((b.type==="offer"&&role!=="phone")||(b.type==="answer"&&role!=="desktop"))throw new LiveError("Signalling role denied",403);if(!validSignalPayload(b.type,b.data))throw new LiveError("Invalid video negotiation");const {db,sessions}=await liveCollections();const ordered=await sessions.findOneAndUpdate({_id:session._id},{$inc:{signalSequence:1}},{returnDocument:"after"});if(!ordered)throw new LiveError("Session expired",403);await db.collection("liveSignals").updateOne({sessionId:session._id,eventId:b.eventId},{$setOnInsert:{sessionId:session._id,eventId:b.eventId,type:b.type,data:b.data??null,sequence:ordered.signalSequence,from:role,to:role==="phone"?"desktop":"phone",expiresAt:session.expiresAt,createdAt:new Date()}},{upsert:true});return Response.json({ok:true});}catch(e){return liveFailure(e);}}

/** Native sender needs signalling only, never the repeated JPEG/geometry in the full status payload. */
export async function GET(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {session,role}=await authenticateLive(request,(await params).sessionId);
 const after=Math.max(0,Number(new URL(request.url).searchParams.get('after'))||0);
 const {db}=await liveCollections();
 const rows=await db.collection('liveSignals').find({sessionId:session._id,to:role,sequence:{$gt:after}}).sort({sequence:1}).limit(100).toArray();
 return Response.json({session:{status:session.status},signals:rows.map(s=>({id:String(s._id),type:s.type,data:s.data})),cursor:rows.at(-1)?.sequence??after},{headers:{'Cache-Control':'no-store'}});
}catch(error){return liveFailure(error)}}
