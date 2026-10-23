import {GoogleGenAI} from "@google/genai";
import {ObjectId,type Document} from "mongodb";
import {getDb} from "./db";
export const EMBEDDING_MODEL="gemini-embedding-001";
export const EMBEDDING_DIMENSIONS=768;
export async function embed(text:string,query=false){
 if(!process.env.GEMINI_API_KEY)throw new Error("Gemini is not configured");
 const result=await new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY}).models.embedContent({model:EMBEDDING_MODEL,contents:text.slice(0,12000),config:{outputDimensionality:EMBEDDING_DIMENSIONS,taskType:query?"RETRIEVAL_QUERY":"RETRIEVAL_DOCUMENT",httpOptions:{timeout:20000}}});
 const v=result.embeddings?.[0]?.values;
 if(!v||v.length!==EMBEDDING_DIMENSIONS||!v.every(Number.isFinite))throw new Error("Embedding response invalid");
 const norm=Math.hypot(...v);if(!norm)throw new Error("Embedding response empty");return v.map(n=>n/norm);
}
/** Incremental indexing is explicit and bounded; never embeds another user's records. */
export async function indexFindings(ownerId:string,inspectionId?:ObjectId){
 const db=await getDb();const docs=await db.collection("findings").find({ownerId,...(inspectionId?{inspectionId}:{}),$or:[{embeddingModel:{$ne:EMBEDDING_MODEL}},{embedding:{$exists:false}}]}).limit(50).toArray();let indexed=0;
 for(const doc of docs){const text=[doc.kind,doc.label,doc.description,doc.damageType].filter(Boolean).join(". ");const embedding=await embed(text);await db.collection("findings").updateOne({_id:doc._id,ownerId},{$set:{embedding,embeddingModel:EMBEDDING_MODEL,embeddedAt:new Date()}});indexed++;}
 return {indexed,remaining:await db.collection("findings").countDocuments({ownerId,...(inspectionId?{inspectionId}:{}),embedding:{$exists:false}})};
}
export function reciprocalRankFusion(lists:Document[][],limit:number){const byId=new Map<string,Document>();for(const docs of lists)docs.forEach((doc,rank)=>{const key=String(doc._id),old=byId.get(key);byId.set(key,{...doc,score:(old?.score||0)+1/(60+rank+1)});});return [...byId.values()].sort((a,b)=>b.score-a.score).slice(0,limit);}
export async function searchFindings(ownerId:string,q:string,roomId:ObjectId|null,mode:string,limit:number){
 const db=await getDb(),filter={ownerId,...(roomId?{roomId}:{})};
 const needed=mode==="text"?["findings_search"]:mode==="semantic"?["findings_vector"]:["findings_search","findings_vector"];
 const indexes=await db.collection("findings").listSearchIndexes().toArray() as Document[];
 if(needed.some(name=>!indexes.some(i=>i.name===name&&i.queryable===true)))throw new Error("SEARCH_NOT_READY");
 const lexical=()=>db.collection("findings").aggregate([{$search:{index:"findings_search",compound:{must:[{text:{query:q,path:["label","description"],fuzzy:{maxEdits:1}}}],filter:[{equals:{path:"ownerId",value:ownerId}},...(roomId?[{equals:{path:"roomId",value:roomId}}]:[])]}}},{$match:filter},{$limit:limit*3},{$project:{embedding:0}}]).toArray();
 const vector=async()=>db.collection("findings").aggregate([{$vectorSearch:{index:"findings_vector",path:"embedding",queryVector:await embed(q,true),numCandidates:Math.max(100,limit*20),limit:limit*3,filter}},{$match:{...filter,embeddingModel:EMBEDDING_MODEL}},{$project:{embedding:0}}]).toArray();
 const lists=mode==="text"?[await lexical()]:mode==="semantic"?[await vector()]:await Promise.all([lexical(),vector()]);
 return reciprocalRankFusion(lists,limit);
}
