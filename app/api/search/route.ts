import {errorResponse} from "@/lib/server/api-error";
import {requireUser,requireOwnedRoom} from "@/lib/server/access";
import {parseObjectId} from "@/lib/server/db";
import {searchFindings,indexFindings} from "@/lib/server/search";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:Request){try{
 const user=await requireUser(request),url=new URL(request.url),q=(url.searchParams.get("q")||"").trim(),roomParam=url.searchParams.get("roomId"),roomId=roomParam?parseObjectId(roomParam):null;
 const mode=url.searchParams.get("mode")||"text",limit=Math.min(50,Math.max(1,parseInt(url.searchParams.get("limit")||"20",10)||20));
 if(!["text","semantic","hybrid"].includes(mode)||q.length>200||(roomParam&&!roomId))return Response.json({error:"Invalid search parameters"},{status:400});
 if(roomId)await requireOwnedRoom(roomId,user.id);
 if(q.length<2)return Response.json({results:[],search:mode});
 const rows=await searchFindings(user.id,q,roomId,mode,limit);
 return Response.json({results:rows.map(r=>({id:String(r._id),inspectionId:String(r.inspectionId),roomId:String(r.roomId),type:r.kind,label:r.label,description:r.description,timestamp:r.timestampSeconds,reviewStatus:r.reviewStatus,score:r.score})),search:mode},{headers:{"Cache-Control":"private, no-store"}});
}catch(error){return errorResponse(error,"app/api/search/route.ts");}}
export async function POST(request:Request){try{const user=await requireUser(request);return Response.json(await indexFindings(user.id));}catch(error){return errorResponse(error,"search.index");}}
