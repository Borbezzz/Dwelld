import {errorResponse} from "@/lib/server/api-error";
import {requireUser} from "@/lib/server/access";
import {getDb} from "@/lib/server/db";
import {searchIndexes,setupSearchIndexes,serverVersion,indexFindings,SEARCH_MODELS} from "@/lib/server/search";
import {voyageConfigured} from "@/lib/server/voyage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
async function status(ownerId:string){
 const db=await getDb(),f=db.collection("findings"),mine={ownerId};
 const [indexes,version,total,text,gemini,photo]=await Promise.all([searchIndexes(db),serverVersion(db),f.countDocuments(mine),f.countDocuments({...mine,searchText:{$exists:true}}),f.countDocuments({...mine,embedding:{$exists:true}}),f.countDocuments({...mine,imageEmbedding:{$exists:true}})]);
 const major=parseInt(version,10);
 return {indexes,version,rankFusion:Number.isFinite(major)?major>=8:null,voyage:voyageConfigured(),gemini:!!process.env.GEMINI_API_KEY,models:SEARCH_MODELS,counts:{total,searchText:text,geminiVectors:gemini,photoVectors:photo}};
}
/** Index and data readiness for the search page: which Atlas indexes exist and how much is embedded. */
export async function GET(request:Request){try{const user=await requireUser(request);return Response.json(await status(user.id),{headers:{"Cache-Control":"private, no-store"}});}catch(e){return errorResponse(e,"search.setup");}}
/** action=indexes creates the Atlas indexes; action=prepare fills searchText and the vectors for your findings. */
export async function POST(request:Request){try{
 const user=await requireUser(request),action=new URL(request.url).searchParams.get("action")||"prepare";
 if(action==="indexes")return Response.json({submitted:await setupSearchIndexes(),...(await status(user.id))});
 const prepared=await indexFindings(user.id,undefined,{limit:40,deadlineMs:Date.now()+240_000});
 return Response.json({prepared,...(await status(user.id))});
}catch(e){return errorResponse(e,"search.setup");}}
