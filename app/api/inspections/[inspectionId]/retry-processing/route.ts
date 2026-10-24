import {recoverExpiredScanRetry} from '@/lib/server/scan-recovery';
import {after} from 'next/server';
import {requireUser,requireOwnedInspection,requireOwnedRoom} from '@/lib/server/access';
import {getDb} from '@/lib/server/db';
import {finishScanReport} from '@/lib/server/scan-report';
import {indexFindings} from '@/lib/server/search';
import {savedScanRecovery} from '@/lib/scan-recovery';
import {errorResponse} from '@/lib/server/api-error';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{inspectionId:string}>}){try{
 const user=await requireUser(request),owned=await requireOwnedInspection((await params).inspectionId,user.id);await requireOwnedRoom(owned.roomId,user.id);const db=await getDb(),scan=await recoverExpiredScanRetry(db,owned);
 if(!savedScanRecovery(String(scan._id),scan).actions.some(a=>a.id==='processing'))return Response.json({error:'No failed processing steps are available to retry. A worker may already be running.'},{status:409});
 const lease=crypto.randomUUID(),report=scan.scanReportStatus==='failed'||['failed','partial'].includes(scan.reportComparisonStatus||'');
 const claimed=await db.collection('inspections').findOneAndUpdate({_id:scan._id,ownerId:user.id,status:{$nin:['queued','processing']},scanReportStatus:{$ne:'processing'},reportComparisonStatus:{$ne:'processing'},searchIndexStatus:{$ne:'processing'},$or:[{recoveryUntil:{$exists:false}},{recoveryUntil:{$lte:new Date()}}]},{$set:{recoveryLease:lease,recoveryUntil:new Date(Date.now()+330_000),...(report?{scanReportStatus:'processing'}:{searchIndexStatus:'processing'})}});
 if(!claimed)return Response.json({error:'A retry is already running for this scan.'},{status:409});
 after(async()=>{try{if(report)await finishScanReport(db,scan._id,Date.now()+210_000);await indexFindings(user.id,scan._id,{deadlineMs:Date.now()+45_000,timeoutMs:15000}).catch(()=>{});}finally{await db.collection('inspections').updateOne({_id:scan._id,recoveryLease:lease},{$unset:{recoveryLease:'',recoveryUntil:''}})}});
 return Response.json({message:'Unfinished processing has restarted. Progress will update on the scan.',inspection:{id:String(scan._id)}},{status:202});
}catch(e){return errorResponse(e,'inspection.retry-processing')}}
