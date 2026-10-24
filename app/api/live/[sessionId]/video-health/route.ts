import {authenticateLive,liveCollections,LiveError,liveFailure} from '@/lib/server/live-sessions';
export const runtime='nodejs';
/** Performance counters only; no camera images or peer addresses are recorded. */
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {session}=await authenticateLive(request,(await params).sessionId,'desktop');
 const {fps,decoded,dropped}=await request.json();
 if(!Number.isFinite(fps)||fps<0||fps>240||![decoded,dropped].every(v=>Number.isSafeInteger(v)&&v>=0))throw new LiveError('Invalid video counters');
 const {sessions}=await liveCollections();await sessions.updateOne({_id:session._id,status:{$ne:'saved'}},{$set:{videoHealth:{fps,decoded,dropped,updatedAt:new Date().toISOString()}}});
 return Response.json({ok:true});
}catch(error){return liveFailure(error)}}
