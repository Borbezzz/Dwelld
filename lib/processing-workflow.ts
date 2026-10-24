import type {Inspection} from './types';
import type {WorkflowRow} from './live/workflow';
export const inspectionLabel=(i:Pick<Inspection,'type'|'createdAt'>)=>`${i.type==='move-out'?'Check-out':'Check-in / rescan'} · ${new Date(i.createdAt).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`;
export function isInspectionProcessing(i?:Inspection|null){return !!i&&(['queued','processing'].includes(i.status)||i.scanReportStatus==='processing'||i.reportComparisonStatus==='processing'||i.searchIndexStatus==='processing');}
export function inspectionWorkflow(i:Inspection):WorkflowRow[]{
 const phase=i.analysisProgress?.phase,p=i.analysisProgress;
 const stage=(value?:string):WorkflowRow['status']=>value==='ready'?'done':value==='failed'?'failed':value==='partial'?'partial':value==='processing'?'running':'waiting';
 const checking=['queued','processing'].includes(i.status)&&!i.scanReportStatus;
 const rows:WorkflowRow[]=[
  {key:'source',label:'Source saved',status:'done',amount:'Stored',details:[{label:'Original capture',meta:'Available for review'}]},
  {key:'analyse',label:'Check source views',status:phase==='failed'||i.status==='failed'?'failed':checking?'running':i.status==='partial'?'partial':'done',amount:p?.totalFrames?`${p.processedFrames}/${p.totalFrames} frames`:i.framesAnalysed?`${i.framesAnalysed} frames`:'Furniture & damage',details:[{label:'Current step',meta:phase==='verifying'?'Cross-checking damage':checking?'Checking saved source views':'Source checks finished'},...(i.analysisWarnings?.length?[{label:'Coverage notices',meta:i.analysisWarnings.join(' ')}]:[])]},
  {key:'report',label:'Generate inventory & condition report',status:i.scanReportStatus?stage(i.scanReportStatus):i.scanReport?'done':checking?'waiting':'partial',amount:i.scanReportStatus==='ready'||i.scanReport?'Saved':!i.scanReportStatus&&!checking?'Unavailable':'Argon',details:[{label:'Room report',meta:i.scanReportError||(!i.scanReportStatus&&!i.scanReport&&!checking?'This older scan has no generated room report.':'Inventory, condition and coverage')}]},
 ];
 if(i.reportComparisonStatus&&i.reportComparisonStatus!=='not-applicable')rows.push({key:'compare',label:'Compare check-in & check-out',status:stage(i.reportComparisonStatus),amount:i.reportComparisonStatus==='ready'?'Saved':'Argon',details:[{label:'Earlier scan',meta:i.comparisonBaselineCreatedAt?inspectionLabel({type:'move-in',createdAt:i.comparisonBaselineCreatedAt}):i.reportComparison?.baselineInspectionId||i.baselineInspectionId||'Earlier check-in'},{label:'Current step',meta:i.comparisonProgress?.phase||'Compare visible source evidence'},{label:'Comparison',meta:i.reportComparisonError||'Visible condition and item changes'}]});
 if(i.searchIndexStatus)rows.push({key:'search',label:'Prepare searchable record',status:stage(i.searchIndexStatus),amount:i.searchIndexStatus==='ready'?'Ready':'Search',details:[{label:'Search preparation',meta:i.searchIndexError||'Indexing the report and observations'}]});
 return rows;
}
