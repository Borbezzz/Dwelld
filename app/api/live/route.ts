import {createLive,liveFailure} from "@/lib/server/live-sessions";
export const runtime="nodejs";
export async function POST(request:Request){try{const body=await request.json();return Response.json(await createLive(body.roomId),{status:201,headers:{"Cache-Control":"no-store"}});}catch(e){return liveFailure(e);}}
