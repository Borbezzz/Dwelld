import {authenticateLive,liveCollections,liveFailure,LiveError} from "@/lib/server/live-sessions";
import {mediaResponse} from "@/lib/server/media";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{const {sessionId}=await params;const {session}=await authenticateLive(request,sessionId);const ref=new URL(request.url).searchParams.get("ref");const {db}=await liveCollections();if(!ref||(!await db.collection("liveEvidence").findOne({sessionId:session._id,ref})&&session.sourceUrl!==ref))throw new LiveError("Evidence not found",404);return await mediaResponse(ref,request);}catch(e){return liveFailure(e);}}
