import type { LiveBatch } from './types';
type Frame={_id?:unknown;batchId?:string;workerSlot?:number;timestampSeconds:number;status:string;ref:string;name:string;attempt?:number;retryMessage?:string;error?:string;findings?:number;warnings?:string[];observations?:LiveBatch['observations'];views?:{label?:string;name?:string;elementId?:string;category?:string;box?:{x:number;y:number;width:number;height:number}}[]};
/** A lane is based on persisted source frames; absence of a result never counts as clear. */
export function batchSummaries(frames:Frame[]):LiveBatch[]{
 const groups=new Map<string,Frame[]>();
 for(const frame of frames){const key=frame.batchId||`queued-${Math.floor(frame.timestampSeconds/6)}`;groups.set(key,[...(groups.get(key)||[]),frame]);}
 return [...groups].map(([id,items])=>{
  items.sort((a,b)=>a.timestampSeconds-b.timestampSeconds);
  const active=items.find(f=>f.status==='analyzing'),failed=items.find(f=>f.status==='failed'),done=items.every(f=>f.status==='done');
  const sample=items.find(f=>f.observations?.length)||active||failed||items[0];
  const count=items.reduce((sum,f)=>sum+(f.findings||0),0),warning=items.some(f=>f.warnings?.length);
  return {id,slot:items[0].workerSlot??null,startSeconds:items[0].timestampSeconds,endSeconds:items.at(-1)!.timestampSeconds,frames:items.length,checked:items.filter(f=>f.status==='done').length,status:active?(active.attempt||1)>1?'retrying':'checking':failed?'failed':done?warning?'unassessed':count?'findings':'clear':'queued',attempt:Math.max(...items.map(f=>f.attempt||1)),message:failed?.error||active?.retryMessage||(warning?'Some checks did not finish. These views need review.':undefined),evidenceRef:sample.ref,timestampSeconds:sample.timestampSeconds,observations:sample.observations||[],findingCount:count,objects:(sample.views||[]).filter(v=>v.box&&v.elementId).map(v=>({id:v.elementId!,label:v.category||'Measured object',boundingBox:v.box!}))} satisfies LiveBatch;
 }).sort((a,b)=>b.endSeconds-a.endSeconds).slice(0,24);
}
