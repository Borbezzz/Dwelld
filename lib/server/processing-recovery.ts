import type {Db,Document} from 'mongodb';
/** All scan workers are bounded to five minutes; allow a two-minute reporting grace period. */
export function stalledProcessingUpdate(inspection:Document,now=Date.now()){
 const start=inspection.analysisStartedAt||inspection.createdAt;
 if(!start||!['queued','processing'].includes(inspection.status)||!Number.isFinite(+new Date(start))||+new Date(start)>now-7*60_000)return null;
 const message='Processing stopped before every check finished. Your saved source files remain available for review.';
 return {status:'partial',analysisWarnings:[...new Set([...(inspection.analysisWarnings||[]),message])],
  ...(inspection.scanReportStatus!=='ready'?{scanReportStatus:'failed',scanReportError:message}:{}),
  ...(inspection.reportComparisonStatus==='processing'?{reportComparisonStatus:'failed',reportComparisonError:message}:{}),
  ...(!['ready','partial'].includes(inspection.searchIndexStatus)?{searchIndexStatus:'failed',searchIndexError:message}:{})};
}
export async function recoverStalledInspection(db:Db,inspection:Document){
 const updates=stalledProcessingUpdate(inspection);if(!updates)return inspection;
 const recovered=await db.collection('inspections').updateOne({_id:inspection._id,status:inspection.status,analysisStartedAt:inspection.analysisStartedAt},{$set:updates});
 return recovered.modifiedCount?Object.assign(inspection,updates):inspection;
}
