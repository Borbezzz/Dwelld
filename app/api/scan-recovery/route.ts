import {LiveError,liveFailure} from '@/lib/server/live-sessions';
import {scanRecovery} from '@/lib/server/scan-recovery';
import {errorResponse} from '@/lib/server/api-error';
export const runtime='nodejs';
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;return Response.json(await scanRecovery(request,{sessionId:q.get('sessionId')||undefined,inspectionId:q.get('inspectionId')||undefined}),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return e instanceof LiveError?liveFailure(e):errorResponse(e,'scan.recovery')}}
