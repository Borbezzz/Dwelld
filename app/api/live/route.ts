import {readJsonBody} from "@/lib/server/request-body";
import {createLive, LiveError, liveFailure} from "@/lib/server/live-sessions";
import {requireUser} from "@/lib/server/access";
import {errorResponse} from "@/lib/server/api-error";
export const runtime="nodejs";
export async function POST(request:Request){try{const user=await requireUser(request);const body=await readJsonBody(request);return Response.json(await createLive(body.roomId,user.id,body.type),{status:201,headers:{"Cache-Control":"no-store"}});}catch(e){return e instanceof LiveError?liveFailure(e):errorResponse(e,"live.create");}}
