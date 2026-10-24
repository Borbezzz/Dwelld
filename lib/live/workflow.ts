import type {InspectionSession} from './types';
export type WorkflowRow={key:string;label:string;amount:string;status:'waiting'|'running'|'done'|'failed'|'partial';details:{label:string;meta:string}[]};
export function scanWorkflow(session:InspectionSession):WorkflowRow[]{
 const p=session.analysisProgress||{checked:0,checking:0,queued:0,failed:0},total=p.checked+p.checking+p.queued+p.failed,saved=session.status==='saved',upload=session.nativeProgress?.upload,w=session.workflow;
 const running=p.checking+p.queued>0,allChecked=total>0&&p.checked===total;
 const stageStatus=(status?:string):WorkflowRow['status']=>status==='ready'?'done':status==='failed'?'failed':status==='partial'?'partial':status==='processing'?'running':'waiting';
 const rows:WorkflowRow[]=[
  {key:'upload',label:'Preserve source files',amount:saved?'Save confirmed':upload==null?`${total} photos received`:`${Math.round(upload*100)}% transferred`,status:saved?'done':session.nativeProgress?.stage==='uploading'||total>0?'running':'waiting',details:[{label:'Source photos received',meta:String(total)},{label:'Original files',meta:saved?'Saved in cloud storage':upload===1?'Transferred; awaiting final save':'Phone retains unfinished files'},{label:'Final save acknowledgement',meta:saved?'Confirmed':'Waiting'}]},
  {key:'analyse',label:'Parse views & check furniture',amount:`${p.checked}/${total} photos`,status:running?'running':p.failed?'partial':allChecked?'done':'waiting',details:[{label:'Four parallel lanes',meta:`${p.checking} photos checking`},{label:'Waiting for a worker',meta:String(p.queued)},{label:'Checks with usable results',meta:String(p.checked)},{label:'Unassessed after retries',meta:String(p.failed)}]},
  {key:'report',label:'Write inventory & condition report',amount:w?.reportStatus==='ready'?'Report saved':'Argon',status:stageStatus(w?.reportStatus),details:[{label:'Room summary and item counts',meta:w?.reportStatus==='ready'?'Saved':'Pending'},{label:'Coverage and limitations',meta:w?.reportStatus==='ready'?'Included':'Pending'},...(w?.reportError?[{label:'Report needs attention',meta:w.reportError}]:[])]},
 ];
 if(w?.comparisonStatus&&w.comparisonStatus!=='not-applicable')rows.push({key:'compare',label:'Compare with check-in',amount:w.comparisonStatus==='ready'?'Comparison saved':'Condition & item counts',status:stageStatus(w.comparisonStatus),details:[{label:'Comparable source views',meta:'Used to verify changes'},{label:'Missing detections',meta:'Never treated as proof of loss'},...(w.comparisonError?[{label:'Comparison needs attention',meta:w.comparisonError}]:[])]});
 rows.push({key:'search',label:'Prepare searchable record',amount:w?.searchStatus==='ready'?'Indexed':'Keywords & vectors',status:stageStatus(w?.searchStatus),details:[{label:'Inventory, report and observations',meta:w?.searchStatus==='ready'?'Indexed':'Pending'},...(w?.searchError?[{label:'Search preparation needs attention',meta:w.searchError}]:[])]});
 return rows;
}
