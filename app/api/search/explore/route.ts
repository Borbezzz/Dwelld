import {errorResponse} from "@/lib/server/api-error";
import {requireUser,requireOwnedRoom} from "@/lib/server/access";
import {parseObjectId} from "@/lib/server/db";
import {runSearch,semanticMap,toResult} from "@/lib/server/search";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
/** Search, explained: every Atlas pipeline's own ranking, the fused $rankFusion result and a map of vector space. */
export async function GET(request:Request){try{
 const user=await requireUser(request),url=new URL(request.url),q=(url.searchParams.get("q")||"").trim(),roomParam=url.searchParams.get("roomId"),roomId=roomParam?parseObjectId(roomParam):null;
 if(q.length>200||(roomParam&&!roomId))return Response.json({error:"Invalid search parameters"},{status:400});
 if(roomId)await requireOwnedRoom(roomId,user.id);
 const [run,map]=await Promise.all([
  q.length>=2?runSearch(user.id,q,roomId,"hybrid",8,true).catch(e=>({error:e instanceof Error&&e.message==="SEARCH_NOT_READY"?"No search index is ready yet. Create the indexes above, then wait for them to show READY.":"Search failed: "+(e instanceof Error?e.message:String(e)).slice(0,200)})):null,
  semanticMap(user.id,q,roomId).catch(e=>({error:(e instanceof Error?e.message:String(e)).slice(0,200)})),
 ]);
 const search=run&&"results" in run?{engine:run.engine,reranked:run.reranked,notes:run.notes,fusionQuery:run.fusionQuery,results:run.results.map(toResult),pipelines:run.pipelines.map(p=>({...p,results:p.results.map(toResult)}))}:run;
 return Response.json({search,map},{headers:{"Cache-Control":"private, no-store"}});
}catch(error){return errorResponse(error,"app/api/search/route.ts");}}
