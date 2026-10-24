import {GoogleGenAI,ThinkingLevel} from "@google/genai";
import sharp from "sharp";
import {requireUser} from "@/lib/server/access";
import {errorResponse} from "@/lib/server/api-error";
import {getDb} from "@/lib/server/db";
import {analysisFailure} from "@/lib/server/analysis-failure";
import {inspectVisibleDamage} from "@/lib/server/damage";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=120;
const safe=(e:unknown)=>{const i=e&&typeof e==="object"?e as {status?:unknown;message?:unknown}:{};return {...analysisFailure(e),status:i.status??null,detail:typeof i.message==="string"?i.message.replace(/AIza[0-9A-Za-z_-]{20,}/g,"[key]").slice(0,300):String(e).slice(0,300)};};
async function timed<T>(fn:()=>Promise<T>){const t=Date.now();try{const result=await fn();return {ok:true as const,ms:Date.now()-t,result};}catch(e){return {ok:false as const,ms:Date.now()-t,error:safe(e)};}}
/** Is Gemini 4 Argon reachable with this deployment's key, and did your recent analyses run? Signed-in users only. */
export async function GET(request:Request){try{
 const user=await requireUser(request),model=process.env.GEMINI_MODEL||"gemini-4-argon",key=process.env.GEMINI_API_KEY;
 const env={geminiKeySet:!!key,model,verifyModel:process.env.GEMINI_VERIFY_MODEL||model,voyageKeySet:!!process.env.VOYAGE_API_KEY,autoApproveThreshold:process.env.AUTO_APPROVE_THRESHOLD||"0.85 (default)"};
 const text=key?await timed(async()=>{const r=await new GoogleGenAI({apiKey:key,httpOptions:{timeout:30000}}).models.generateContent({model,contents:"Reply with exactly: Dwelld Argon OK",config:{thinkingConfig:{thinkingLevel:ThinkingLevel.LOW}}});return {reply:(r.text||"").slice(0,80),modelVersion:r.modelVersion||null,tokens:r.usageMetadata?.totalTokenCount??null};}):{ok:false,error:{code:"AI_NOT_CONFIGURED",detail:"GEMINI_API_KEY is not set in this deployment"}};
 // A grey wall with a dark scuff: the same structured damage call the scan pipeline makes.
 const image=await sharp({create:{width:640,height:480,channels:3,background:"#c9c4bb"}}).composite([{input:Buffer.from('<svg width="640" height="480"><path d="M250 220 C300 200 340 260 400 240" stroke="#2c2a27" stroke-width="9" fill="none" stroke-linecap="round"/></svg>')}]).png().toBuffer();
 const vision=key?await timed(async()=>{const found=await inspectVisibleDamage(image);return {observations:found.length,sample:found.slice(0,2)};}):null;
 const db=await getDb();
 const recent=await db.collection("inspections").find({ownerId:user.id},{projection:{status:1,createdAt:1,captureSource:1,analysisWarnings:1}}).sort({createdAt:-1}).limit(5).toArray();
 const counts=await db.collection("findings").aggregate([{$match:{ownerId:user.id,inspectionId:{$in:recent.map(r=>r._id)}}},{$group:{_id:{inspectionId:"$inspectionId",source:{$ifNull:["$detectionSource","$source"]}},n:{$sum:1}}}]).toArray();
 const issues=await db.collection("liveSessions").find({ownerId:user.id,analysisIssue:{$exists:true}},{projection:{analysisIssue:1,createdAt:1}}).sort({createdAt:-1}).limit(3).toArray().catch(()=>[]);
 return Response.json({env,argonText:text,argonVision:vision,
  recentInspections:recent.map(r=>({id:String(r._id),createdAt:r.createdAt,status:r.status,source:r.captureSource||"video",warnings:(r.analysisWarnings||[]).slice(0,6),findingsBySource:Object.fromEntries(counts.filter(c=>String(c._id.inspectionId)===String(r._id)).map(c=>[String(c._id.source||"unknown"),c.n]))})),
  liveSessionIssues:issues.map(i=>({at:i.analysisIssue?.at,code:i.analysisIssue?.code,message:i.analysisIssue?.message}))},{headers:{"Cache-Control":"no-store"}});
}catch(e){return errorResponse(e,"diagnostics.ai");}}
