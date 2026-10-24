import type {WorkflowRow} from './live/workflow';
export type ComparisonBatchProgress={id:string;status:'queued'|'running'|'retrying'|'done'|'failed';targets:number;attempt:number;changes?:number;error?:string};
export type ComparisonProgress={stage?:'prepare'|'images'|'compare'|'save'|'complete';phase:string;processed?:number;total?:number;usable?:number;batches?:ComparisonBatchProgress[];partial?:boolean};
export function comparisonProgressView(progress?:ComparisonProgress|null,status='processing'){
 const p=progress||{phase:'Preparing saved evidence'},stage=p.stage||(status==='ready'?'complete':/saving/i.test(p.phase)?'save':/comparing|argon/i.test(p.phase)?'compare':/images/i.test(p.phase)?'images':'prepare');
 const index=['prepare','images','compare','save','complete'].indexOf(stage),batches=p.batches||[],done=batches.filter(b=>b.status==='done').length,failed=batches.filter(b=>b.status==='failed').length;
 const partial=!!p.partial||status==='partial',complete=stage==='complete',stopped=status==='failed';
 const rows:WorkflowRow[]=[
  {key:'prepare',label:'Gather both scans',amount:'Evidence & reports',status:'waiting',details:[{label:'Context',meta:'Both scans stay available to every comparison batch'}]},
  {key:'images',label:'Prepare source images',amount:p.total?`${p.processed||0}/${p.total} checked`:'Saved photos',status:'waiting',details:[{label:'Readable images',meta:p.usable==null?'Preparing saved photos':`${p.usable} usable images`}]},
  {key:'compare',label:'Compare in parallel batches',amount:batches.length?`${done}/${batches.length} batches`:'Argon',status:'waiting',details:batches.length?batches.map((b,i)=>({label:`Batch ${i+1} · ${b.targets} checks`,meta:b.status==='done'?`${b.changes||0} candidate changes`:b.status==='failed'?b.error||'Unassessed':b.status==='retrying'?`Retry ${b.attempt} of 3`:b.status==='running'?'Argon is checking':'Queued'})):[{label:'Comparison',meta:p.phase}]},
  {key:'save',label:'Merge findings & save comparison',amount:complete?'Saved':'Deduplicate damage',status:'waiting',details:[{label:'Repeated damage',meta:'One correspondence per damage mark'},{label:'Unfinished batches',meta:failed?`${failed} batches need retry`:'Every batch must finish before the result is complete'}]},
 ];
 rows.forEach((row,i)=>{row.status=i<index?'done':i===index?(stopped?'failed':'running'):'waiting';});
 if(complete)rows.forEach(row=>row.status='done');
 if(partial)rows[2].status='partial';
 const fraction=stage==='images'&&p.total?Math.min(1,(p.processed||0)/p.total):stage==='compare'&&batches.length?done/batches.length:0;
 const value=complete?(partial?3:4):Math.min(3.99,index+fraction);
 return {rows,value,max:4,label:stopped?'Comparison stopped · unfinished checks need retry':complete?(partial?'Comparison saved with incomplete checks':'Comparison saved'):p.phase,detail:stage==='compare'&&batches.length?`${done}/${batches.length} batches completed${failed?` · ${failed} unassessed`:''}`:stage==='images'&&p.total?`${p.processed||0}/${p.total} images checked${p.usable==null?'':` · ${p.usable} readable`}`:`${complete?partial?3:4:Math.max(0,index)}/4 steps completed`};
}
