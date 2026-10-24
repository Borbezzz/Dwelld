export type RecoveryAction={id:'video'|'processing'|'live';label:string;description:string;url:string};
export type ScanRecovery={message:string;actions:RecoveryAction[]};
type RecordState={[key:string]:unknown;status?:string;sourceUrl?:string;scanReportStatus?:string;reportComparisonStatus?:string;searchIndexStatus?:string};
export function savedScanRecovery(id:string,scan:RecordState,owner=true):ScanRecovery{
 if(!owner)return {message:'You can view this shared scan. Its owner can restart unfinished checks.',actions:[]};
 if(['queued','processing'].includes(scan.status||'')||[scan.scanReportStatus,scan.reportComparisonStatus,scan.searchIndexStatus].includes('processing'))return {message:'This scan is still processing. Its progress will update here.',actions:[]};
 const actions:RecoveryAction[]=[];
 if(['partial','failed'].includes(scan.status||'')&&scan.sourceUrl)actions.push({id:'video',label:'Retry saved video',description:'Create a new analysis attempt from the saved video. Your original record stays available.',url:`/api/inspections/${id}/retry`});
 if(scan.scanReportStatus==='failed'||['failed','partial'].includes(scan.reportComparisonStatus||'')||['failed','partial'].includes(scan.searchIndexStatus||''))actions.push({id:'processing',label:'Retry unfinished processing',description:'Restart the unfinished report, checkout comparison or search preparation using saved evidence.',url:`/api/inspections/${id}/retry-processing`});
 return {message:actions.length?'Some checks did not finish. You can restart them from the saved evidence.':scan.status==='failed'||scan.status==='partial'?'This scan needs review. There is no retryable saved video or failed report step; review its evidence or capture another view.':'No failed processing steps were found for this scan.',actions};
}
export function isRecoveryQuestion(question:string){return /\b(retry|restart|reprocess|try again|scan (?:failed|stuck)|processing (?:failed|stuck)|why.*(?:scan|processing).*fail)\b/i.test(question);}
