import {GoogleGenAI} from "@google/genai";
import {ObjectId,type Db,type Document} from "mongodb";
import {getDb} from "./db";
import {INDEX,AUTO_EMBED_MODEL,PIPELINE_LABELS,DEFAULT_WEIGHTS,searchText,indexDefinitions,keywordPipeline,autoEmbedPipeline,geminiVectorPipeline,photoPipeline,standalone,rankFusionPipeline,appRankFusion,displayPipeline,ranksOf} from "./search-pipelines";
import {voyageConfigured,embedEvidence,embedQueryForImages,rerank,IMAGE_DIMENSIONS,VOYAGE_MULTIMODAL_MODEL,VOYAGE_RERANK_MODEL} from "./voyage";
import {projectMap} from "./semantic-map";
export const EMBEDDING_MODEL="gemini-embedding-001";
export const EMBEDDING_DIMENSIONS=768;
export async function embed(text:string,query=false,timeoutMs=20000){
 if(!process.env.GEMINI_API_KEY)throw new Error("Gemini is not configured");
 const result=await new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY}).models.embedContent({model:EMBEDDING_MODEL,contents:text.slice(0,12000),config:{outputDimensionality:EMBEDDING_DIMENSIONS,taskType:query?"RETRIEVAL_QUERY":"RETRIEVAL_DOCUMENT",httpOptions:{timeout:timeoutMs}}});
 const v=result.embeddings?.[0]?.values;
 if(!v||v.length!==EMBEDDING_DIMENSIONS||!v.every(Number.isFinite))throw new Error("Embedding response invalid");
 const norm=Math.hypot(...v);if(!norm)throw new Error("Embedding response empty");return v.map(n=>n/norm);
}

/** What still needs preparing for search. Automated Embedding needs only `searchText`; Atlas does the rest. */
function pendingFilter(ownerId:string,inspectionId?:ObjectId):Document{
 const or:Document[]=[{searchText:{$exists:false}},{embeddingModel:{$ne:EMBEDDING_MODEL}},{embedding:{$exists:false}}];
 if(voyageConfigured())or.push({evidenceFrameUrl:{$type:"string"},imageEmbeddingModel:{$ne:VOYAGE_MULTIMODAL_MODEL},imageEmbeddingFailed:{$ne:VOYAGE_MULTIMODAL_MODEL}});
 return {ownerId,...(inspectionId?{inspectionId}:{}),$or:or};
}
/** Incremental indexing is explicit and bounded; never embeds another user's records. */
export async function indexFindings(ownerId:string,inspectionId?:ObjectId,options:{limit?:number;deadlineMs?:number;timeoutMs?:number}={}){
 const db=await getDb(),findings=db.collection("findings");
 const docs=await findings.find(pendingFilter(ownerId,inspectionId),{projection:{imageEmbedding:0}}).limit(options.limit??50).toArray();let indexed=0;
 for(const doc of docs){
  if(Date.now()>=(options.deadlineMs??Infinity))break;
  const set:Document={searchText:searchText(doc)};
  if(doc.embeddingModel!==EMBEDDING_MODEL||!doc.embedding){try{set.embedding=await embed(set.searchText,false,options.timeoutMs??20000);set.embeddingModel=EMBEDDING_MODEL;set.embeddedAt=new Date();}catch(e){if(!voyageConfigured())throw e;}}
  if(voyageConfigured()&&typeof doc.evidenceFrameUrl==="string"&&doc.imageEmbeddingModel!==VOYAGE_MULTIMODAL_MODEL){
   try{set.imageEmbedding=await embedEvidence(doc.evidenceFrameUrl,doc.boundingBox);set.imageEmbeddingModel=VOYAGE_MULTIMODAL_MODEL;}
   catch(e){console.error("photo embedding failed",e instanceof Error?e.message:e);set.imageEmbeddingFailed=VOYAGE_MULTIMODAL_MODEL;}
  }
  await findings.updateOne({_id:doc._id,ownerId},{$set:set});indexed++;
 }
 return {indexed,remaining:await findings.countDocuments(pendingFilter(ownerId,inspectionId))};
}
export function reciprocalRankFusion(lists:Document[][],limit:number){return appRankFusion(Object.fromEntries(lists.map((l,i)=>[`p${i}`,l])),limit,{});}

export type IndexState={name:string;type:string;status:string;queryable:boolean};
export async function searchIndexes(db:Db):Promise<Record<string,IndexState>>{
 const rows=await db.collection("findings").listSearchIndexes().toArray() as Document[];
 return Object.fromEntries(rows.map(r=>[r.name,{name:r.name,type:r.type||"search",status:r.status||"UNKNOWN",queryable:r.queryable===true}]));
}
/** Creates or updates every Atlas Search / Vector Search index Dwelld uses. Idempotent. */
export async function setupSearchIndexes(){
 const db=await getDb(),c=db.collection("findings"),existing=await searchIndexes(db),out:Record<string,string>={};
 for(const index of indexDefinitions(IMAGE_DIMENSIONS)){
  try{if(existing[index.name])await c.updateSearchIndex(index.name,index.definition);else await c.createSearchIndex(index as never);out[index.name]="submitted";}
  catch(e){out[index.name]=`failed: ${(e instanceof Error?e.message:String(e)).slice(0,160)}`;}
 }
 return out;
}
export async function serverVersion(db:Db){try{return String((await db.command({buildInfo:1})).version);}catch{return "unknown";}}

type Mode="text"|"semantic"|"image"|"hybrid";
type Plan={name:string;label:string;index:string;engine:string;pipeline:Document[];kind:"search"|"vector"};
async function plan(db:Db,ownerId:string,q:string,roomId:ObjectId|null,mode:Mode,limit:number){
 const scope={ownerId,...(roomId?{roomId}:{})},indexes=await searchIndexes(db),ready=(n:string)=>indexes[n]?.queryable===true,plans:Plan[]=[],notes:string[]=[];
 const L=limit*3;
 if(mode==="text"||mode==="hybrid"){if(ready(INDEX.keyword))plans.push({name:"keyword",label:PIPELINE_LABELS.keyword,index:INDEX.keyword,engine:"Atlas Search, Lucene BM25 with fuzzy matching",pipeline:keywordPipeline(q,scope,L),kind:"search"});else notes.push(`${INDEX.keyword} is not ready`);}
 if(mode==="semantic"||mode==="hybrid"){
  if(ready(INDEX.auto))plans.push({name:"meaning",label:PIPELINE_LABELS.meaning,index:INDEX.auto,engine:`Automated Embedding, Atlas embeds with ${AUTO_EMBED_MODEL}`,pipeline:autoEmbedPipeline(q,scope,L),kind:"vector"});
  else if(ready(INDEX.gemini)){plans.push({name:"meaning",label:PIPELINE_LABELS.meaning,index:INDEX.gemini,engine:`${EMBEDDING_MODEL} query vector (Automated Embedding index not ready)`,pipeline:geminiVectorPipeline(await embed(q,true),scope,L,EMBEDDING_MODEL),kind:"vector"});notes.push(`${INDEX.auto} is not ready; meaning search uses Gemini embeddings`);}
  else notes.push("No meaning index is ready");
 }
 if(mode==="image"||mode==="hybrid"){
  if(!voyageConfigured())notes.push("VOYAGE_API_KEY is not set; photo search is off");
  else if(!ready(INDEX.image))notes.push(`${INDEX.image} is not ready`);
  else plans.push({name:"photo",label:PIPELINE_LABELS.photo,index:INDEX.image,engine:`${VOYAGE_MULTIMODAL_MODEL}, text query against photo vectors`,pipeline:photoPipeline(await embedQueryForImages(q),scope,L),kind:"vector"});
 }
 if(!plans.length)throw new Error("SEARCH_NOT_READY");
 return {plans,notes,indexes};
}

export type SearchRun={results:Document[];engine:string;reranked:boolean;notes:string[];pipelines:{name:string;label:string;index:string;engine:string;results:Document[];query:unknown}[];fusionQuery?:unknown;indexes:Record<string,IndexState>};
/** One search. `explain` also runs every input pipeline on its own so the page can show each ranking. */
export async function runSearch(ownerId:string,q:string,roomId:ObjectId|null,mode:Mode,limit:number,explain=false):Promise<SearchRun>{
 const db=await getDb(),c=db.collection("findings"),{plans,notes,indexes}=await plan(db,ownerId,q,roomId,mode,limit);
 const each=async()=>Object.fromEntries(await Promise.all(plans.map(async p=>[p.name,await c.aggregate(standalone(p.pipeline,p.kind)).toArray()]))) as Record<string,Document[]>;
 let results:Document[],engine:string,lists:Record<string,Document[]>|null=null,fusionQuery:unknown;
 if(plans.length===1){lists=await each();results=lists[plans[0].name].slice(0,limit*2);engine=plans[0].engine;}
 else{
  const pipelines=Object.fromEntries(plans.map(p=>[p.name,p.pipeline])),fusion=rankFusionPipeline(pipelines,limit*2);fusionQuery=displayPipeline(fusion);
  try{results=await c.aggregate(fusion).toArray();engine="$rankFusion, native hybrid search in Atlas";}
  catch(e){lists=await each();results=appRankFusion(lists,limit*2);engine="Reciprocal rank fusion in the app ($rankFusion unavailable on this cluster)";notes.push(`$rankFusion failed: ${(e instanceof Error?e.message:String(e)).slice(0,120)}`);}
 }
 let reranked=false;
 if(voyageConfigured()&&results.length>1&&mode!=="text"){
  try{const scores=await rerank(q,results.map(r=>r.searchText||searchText(r)));results=results.map((r,i)=>({...r,rerankScore:scores[i]})).sort((a,b)=>b.rerankScore-a.rerankScore);reranked=true;}
  catch(e){notes.push(`Voyage rerank skipped: ${(e instanceof Error?e.message:String(e)).slice(0,120)}`);}
 }
 if(explain&&!lists)lists=await each();
 const clean=(r:Document)=>{const {embedding:_e,imageEmbedding:_i,...rest}=r;void _e;void _i;return {...rest,ranks:ranksOf(r)};};
 return {results:results.slice(0,limit).map(clean),engine,reranked,notes,fusionQuery,indexes,
  pipelines:plans.map(p=>({name:p.name,label:p.label,index:p.index,engine:p.engine,query:displayPipeline(standalone(p.pipeline,p.kind)),results:(lists?.[p.name]||[]).slice(0,limit).map(clean)}))};
}
export async function searchFindings(ownerId:string,q:string,roomId:ObjectId|null,mode:string,limit:number){
 return (await runSearch(ownerId,q,roomId,(["text","semantic","image","hybrid"].includes(mode)?mode:"text") as Mode,limit)).results;
}

/** Findings laid out by their vectors. Photo vectors when Voyage is set, else Gemini text vectors. */
export async function semanticMap(ownerId:string,q:string,roomId:ObjectId|null){
 const db=await getDb(),photo=voyageConfigured()&&await db.collection("findings").countDocuments({ownerId,imageEmbeddingModel:VOYAGE_MULTIMODAL_MODEL},{limit:3})>=3;
 const field=photo?"imageEmbedding":"embedding";
 const docs=await db.collection("findings").find({ownerId,...(roomId?{roomId}:{}),[field]:{$exists:true},reviewStatus:{$ne:"rejected"}},{projection:{label:1,kind:1,damageType:1,reviewStatus:1,evidenceFrameUrl:1,boundingBox:1,inspectionId:1,[field]:1}}).sort({_id:-1}).limit(160).toArray();
 let query:number[]|null=null;
 if(q.length>=2){try{query=photo?await embedQueryForImages(q):await embed(q,true);}catch{query=null;}}
 const map=projectMap(docs.map(d=>d[field] as number[]),query);
 return {space:photo?`${VOYAGE_MULTIMODAL_MODEL} (photos and words share one space)`:`${EMBEDDING_MODEL} (text)`,photo,
  query:map.query,points:docs.map((d,i)=>({id:String(d._id),inspectionId:String(d.inspectionId),label:d.label,kind:d.kind,damageType:d.damageType,reviewStatus:d.reviewStatus,evidenceFrameUrl:d.evidenceFrameUrl,boundingBox:d.boundingBox,...map.points[i]}))};
}
export const SEARCH_MODELS={autoEmbed:AUTO_EMBED_MODEL,photo:VOYAGE_MULTIMODAL_MODEL,rerank:VOYAGE_RERANK_MODEL,gemini:EMBEDDING_MODEL,weights:DEFAULT_WEIGHTS};

/** The API shape of one search hit. */
export const toResult=(r:Document)=>({id:String(r._id),inspectionId:String(r.inspectionId),roomId:String(r.roomId),type:r.kind,label:r.label,description:r.description,damageType:r.damageType,timestamp:r.timestampSeconds,reviewStatus:r.reviewStatus,evidenceFrameUrl:r.evidenceFrameUrl,boundingBox:r.boundingBox,score:r.score,rerankScore:r.rerankScore,ranks:r.ranks});
