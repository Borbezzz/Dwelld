import {requireUser} from './access';
import {requireReadableInspection} from './space-access';
import {authenticateLive,LiveError} from './live-sessions';
import {getDb,parseObjectId} from './db';
import type {Db,Document} from 'mongodb';
import {recoverStalledInspection} from './processing-recovery';
import {savedScanRecovery,type ScanRecovery} from '../scan-recovery';
/** A terminated retry worker must become retryable again once its bounded lease expires. */
export async function recoverExpiredScanRetry(db:Db,scan:Document){
 const original=await recoverStalledInspection(db,scan);
 if(!original.recoveryLease||!original.recoveryUntil||+new Date(original.recoveryUntil)>Date.now())return original;
 const updates:Record<string,string>={};
 for(const [status,error] of [['scanReportStatus','scanReportError'],['reportComparisonStatus','reportComparisonError'],['searchIndexStatus','searchIndexError']])if(original[status]==='processing'){updates[status]='failed';updates[error]='The retry worker stopped before completion. Saved evidence is available for another attempt.';}
 const result=await db.collection('inspections').updateOne({_id:original._id,recoveryLease:original.recoveryLease,recoveryUntil:{$lte:new Date()}},{$set:updates,$unset:{recoveryLease:'',recoveryUntil:''}});
 if(result.modifiedCount){Object.assign(original,updates);delete original.recoveryLease;delete original.recoveryUntil;}
 return original;
}
export async function scanRecovery(request:Request,scope:{sessionId?:unknown;inspectionId?:unknown}):Promise<ScanRecovery>{
 const db=await getDb();
 if(typeof scope.sessionId==='string'){
  const {session}=await authenticateLive(request,scope.sessionId);
  if(session.status==='saved'&&session.inspectionId){const scan=await db.collection('inspections').findOne({_id:session.inspectionId});return scan?savedScanRecovery(String(scan._id),await recoverExpiredScanRetry(db,scan)):{message:'Open the saved scan from its room to check processing.',actions:[]};}
  const blocked=await db.collection('liveSessions').findOne({_id:session._id,'analysisIssue.blocksService':true});
  if(blocked)return {message:(session.analysisIssue?.message||'AI checks are unavailable.')+' The AI service configuration or billing issue must be resolved before retrying.',actions:[]};
  const failed=await db.collection('liveFrames').countDocuments({sessionId:session._id,status:'failed',errorCode:{$in:['AI_UNAVAILABLE','AI_RATE_LIMITED','AI_INVALID_RESPONSE']}});
  return {message:failed?`${failed} source checks can be retried using saved frames.`:'No retryable failed source checks were found. Live checks may still be running.',actions:failed?[{id:'live',label:'Retry failed source checks',description:'Requeue failed AI checks using the frames already uploaded.',url:`/api/live/${session._id}/analysis/retry`}]:[]};
 }
 const id=typeof scope.inspectionId==='string'?parseObjectId(scope.inspectionId):null;if(!id)throw new LiveError('Choose a scan to check its processing.');
 const user=await requireUser(request),scan=await requireReadableInspection(id,user.id);return savedScanRecovery(String(id),scan.ownerId===user.id?await recoverExpiredScanRetry(db,scan):scan,scan.ownerId===user.id);
}
