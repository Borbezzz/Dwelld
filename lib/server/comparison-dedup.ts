import {ObjectId,type Db,type Document} from 'mongodb';
import {groupedDamage} from './damage-groups';
import {dedupeDamageChanges,type ComparisonChange,type ComparisonEvidence} from '../comparison';
/** Reconcile saved comparison snapshots with same-scan damage groups, without rewriting review history. */
export async function groupedComparison(db:Db,record:Document){
 const sides=await Promise.all(['baseline','current'].map(async side=>{
  const evidence=(record[side]||[]) as ComparisonEvidence[],inspectionId=record[`${side}InspectionId`] as ObjectId;
  const ids=evidence.filter(f=>f.kind==='damage'&&/^[a-f0-9]{24}$/.test(f.id)).map(f=>new ObjectId(f.id));
  const originals=ids.length?await db.collection('findings').find({inspectionId,_id:{$in:ids}},{projection:{kind:1,damageType:1,source:1,reviewStatus:1,autoApproved:1,autoRejected:1,spatialElementId:1,worldPosition:1,evidenceFrameUrl:1,timestampSeconds:1,boundingBox:1,objectBoundingBox:1,viewSignature:1,cropSignature:1,evidenceObservations:1,sourceObservationIds:1}}).toArray():[];
  const originalsById=new Map(originals.map(f=>[String(f._id),f]));
  const grouped=await groupedDamage(db,inspectionId,evidence.map(f=>({...f,...originalsById.get(f.id),id:f.id})),undefined);
  const aliases=new Map<string,string>();
  for(const f of grouped)for(const id of [String(f.id),...(f.sourceObservationIds||[])])aliases.set(id,String(f.id));
  return {evidence:grouped.map(({viewSignature:_,cropSignature:__,...f})=>({...f,id:String(f.id)})) as ComparisonEvidence[],aliases};
 }));
 const changes=(record.changes as ComparisonChange[]).map(c=>({...c,baselineFindingId:c.baselineFindingId?sides[0].aliases.get(c.baselineFindingId)||c.baselineFindingId:null,currentFindingId:c.currentFindingId?sides[1].aliases.get(c.currentFindingId)||c.currentFindingId:null}));
 return {...record,baseline:sides[0].evidence,current:sides[1].evidence,changes:dedupeDamageChanges(changes,{baseline:new Map(sides[0].evidence.map(f=>[f.id,f.kind])),current:new Map(sides[1].evidence.map(f=>[f.id,f.kind]))})};
}
/** Room overview flags use the same canonical changes as the full comparison screen. */
export async function groupedReportFlags(db:Db,summary:Document|null|undefined){
 if(!summary?.id||!/^[a-f0-9]{24}$/.test(String(summary.id)))return summary??null;
 const record=await db.collection('comparisons').findOne({_id:new ObjectId(String(summary.id))});if(!record)return summary;
 const grouped=await groupedComparison(db,record);
 return {...summary,flags:grouped.changes.filter(c=>c.reviewStatus!=='rejected'&&['missing_or_changed','potentially_new','uncertain'].includes(c.category))};
}
