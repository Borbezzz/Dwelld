import {authenticateLive,getLiveState,liveFailure} from "@/lib/server/live-sessions";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{const {sessionId}=await params;const {session,role}=await authenticateLive(request,sessionId);return Response.json(await getLiveState(session,role,new URL(request.url).searchParams.get("after")),{headers:{"Cache-Control":"no-store"}});}catch(e){return liveFailure(e);}}
