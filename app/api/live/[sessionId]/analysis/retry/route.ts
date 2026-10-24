import {after} from 'next/server';
import {authenticateLive,liveCollections,liveFailure,LiveError} from '@/lib/server/live-sessions';
import {analyzeLiveEvidenceFrame} from '@/lib/server/native-analysis';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {session}=await authenticateLive(request,(await params).sessionId);
 if(session.status==='saved')throw new LiveError('Open the saved inspection to retry its remaining checks.',409);
 const {db,sessions}=await liveCollections();
 const blocked=await sessions.findOne({_id:session._id,'analysisIssue.blocksService':true});
 if(blocked)throw new LiveError('Resolve the AI service configuration or billing issue before retrying.',409);
 const result=await db.collection('liveFrames').updateMany({sessionId:session._id,status:'failed',errorCode:{$in:['AI_UNAVAILABLE','AI_RATE_LIMITED','AI_INVALID_RESPONSE']}},{$set:{status:'queued'},$unset:{error:'',errorCode:'',retryMessage:''}});
 await sessions.updateOne({_id:session._id},{$unset:{analysisIssue:''}});
 after(()=>analyzeLiveEvidenceFrame(session._id,''));
 return Response.json({queued:result.modifiedCount});
}catch(error){return liveFailure(error);}}
