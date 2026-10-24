import type {ComparisonEvidence,ComparisonChange} from '../comparison';
import type {ComparisonBatchProgress,ComparisonProgress} from '../comparison-progress';
import {dedupeDamageChanges} from '../comparison';
import {retryAnalysis} from './analysis-retry';
import {analysisFailure} from './analysis-failure';
export type ComparisonBatch={id:string;baselineIds:string[];currentIds:string[]};
/** Disjoint target assignments; callers retain BOTH scans' full selected image context in every call. */
export function comparisonBatches(baseline:ComparisonEvidence[],current:ComparisonEvidence[]):ComparisonBatch[]{
 const targets=[...current.map(f=>({side:'current' as const,id:f.id})),...baseline.map(f=>({side:'baseline' as const,id:f.id}))];
 const count=Math.min(4,Math.max(1,Math.ceil(targets.length/8)));
 const batches=Array.from({length:count},(_,i)=>({id:`batch-${i+1}`,baselineIds:[] as string[],currentIds:[] as string[]}));
 targets.forEach((t,i)=>batches[i%count][t.side==='current'?'currentIds':'baselineIds'].push(t.id));return batches;
}
export async function runComparisonBatches(baseline:ComparisonEvidence[],current:ComparisonEvidence[],run:(batch:ComparisonBatch)=>Promise<ComparisonChange[]>,options:{deadlineMs:number;onProgress?:(progress:ComparisonProgress)=>Promise<void>;images:{processed:number;total:number;usable:number}}){
 const plan=comparisonBatches(baseline,current),states:ComparisonBatchProgress[]=plan.map(b=>({id:b.id,status:'queued',targets:b.baselineIds.length+b.currentIds.length,attempt:1}));
 let progressWrites=Promise.resolve();
 const emit=()=>{const progress:ComparisonProgress={...options.images,stage:'compare',phase:'Argon is comparing condition and item counts',batches:states.map(b=>({...b}))};progressWrites=progressWrites.then(()=>options.onProgress?.(progress));return progressWrites;};
 await emit();
 const outcomes=await Promise.allSettled(plan.map(async(batch,index)=>{
  states[index].status='running';await emit();
  try{
   const changes=await retryAnalysis(async()=>{if(Date.now()>=options.deadlineMs)throw Error('Comparison time budget exhausted');return run(batch);},{deadlineMs:options.deadlineMs,onRetry:async attempt=>{states[index].status='retrying';states[index].attempt=attempt;await emit();}});
   // Ignore unsolicited rows about context-only evidence assigned to a different worker.
   const baselineTargets=new Set(batch.baselineIds),currentTargets=new Set(batch.currentIds);
   const owned=changes.filter(c=>c.currentFindingId&&currentTargets.has(c.currentFindingId)||c.baselineFindingId&&baselineTargets.has(c.baselineFindingId));
   states[index].status='done';states[index].changes=owned.length;await emit();return owned;
  }catch(error){states[index].status='failed';states[index].error=analysisFailure(error).message;await emit();throw error;}
 }));
 await progressWrites;
 if(outcomes.every(o=>o.status==='rejected'))throw new Error(`${states[0].error} No comparison batches finished. Saved evidence remains available.`);
 const kinds={baseline:new Map(baseline.map(f=>[f.id,f.kind])),current:new Map(current.map(f=>[f.id,f.kind]))};
 const candidates=outcomes.flatMap(o=>o.status==='fulfilled'?o.value:[]),unique=dedupeDamageChanges(candidates,kinds);
 const failed=states.filter(b=>b.status==='failed');
 return {changes:unique.slice(0,80).map((c,i)=>({...c,id:`change-${i+1}`})),partial:failed.length>0,warnings:[...failed.map(b=>`${b.id} could not finish: ${b.error} Its assigned views remain unassessed.`),...(unique.length>80?['Only the first 80 distinct changes are included.']:[])],progress:{...options.images,stage:'save' as const,phase:'Merging repeated findings and saving the comparison',batches:states.map(b=>({...b})),partial:failed.length>0}};
}
