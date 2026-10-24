import {authenticateLive,liveCollections,liveFailure,LiveError} from "@/lib/server/live-sessions";
import {mediaResponse} from "@/lib/server/media";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** The earlier scan's ARWorldMap, so a continuing phone can relocalize into the same coordinates. */
export async function GET(request:Request,{params}:{params:Promise<{sessionId:string}>}){try{
 const {session}=await authenticateLive(request,(await params).sessionId,"phone");
 if(!session.continueFrom)throw new LiveError("This inspection does not continue an earlier scan",404);
 const {db}=await liveCollections();
 const capture=await db.collection("spatialCaptures").findOne({inspectionId:session.continueFrom,ownerId:session.ownerId},{projection:{"manifest.assets":1}});
 const map=(capture?.manifest?.assets as {kind:string;mediaRef:string}[]|undefined)?.find(a=>a.kind==="worldmap");
 if(!map)throw new LiveError("The earlier scan has no saved position map",404);
 return await mediaResponse(map.mediaRef,request);
}catch(e){return liveFailure(e);}}
