import {after} from "next/server";
import {analyzeLiveEvidenceFrame} from "@/lib/server/native-analysis";
import {authenticateLive,getLiveState,liveFailure} from "@/lib/server/live-sessions";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{const {sessionId}=await params;const {session,role}=await authenticateLive(request,sessionId);const state=await getLiveState(session,role,new URL(request.url).searchParams.get("after"));if(session.status!=="saved"&&(state.session.analysisProgress.queued||state.session.analysisProgress.checking))after(()=>analyzeLiveEvidenceFrame(session._id,""));return Response.json(state,{headers:{"Cache-Control":"no-store"}});}catch(e){return liveFailure(e);}}
