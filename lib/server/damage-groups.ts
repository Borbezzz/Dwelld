import type {Db,Document,ObjectId} from 'mongodb';
import {canonicalDamageFindings,damageId} from '../damage-identity';
/** Legacy native findings kept their world anchor in spatialMarkers rather than the finding itself. */
export async function groupedDamage(db:Db,inspectionId:ObjectId,findings:Document[],knownMarkers?:Document[]){
 let markers=knownMarkers||[];
 if(!knownMarkers&&findings.some(f=>f.kind==='damage'&&f.spatialElementId&&!f.worldPosition))markers=await db.collection('spatialMarkers').find({inspectionId,deletedAt:{$exists:false}}).toArray();
 const anchors=new Map(markers.filter(m=>m.findingId).map(m=>[String(m.findingId),m]));
 return canonicalDamageFindings(findings.map(f=>{const anchor=anchors.get(damageId(f));return anchor?{...f,worldPosition:f.worldPosition||anchor.position,spatialElementId:f.spatialElementId||anchor.elementId}:f;}));
}
export function canonicalMarkers(markers:Document[],findings:Document[]){
 const bySource=new Map<string,Document>(findings.flatMap(f=>(f.sourceObservationIds||[damageId(f)]).map((id:string)=>[id,f] as const))),seen=new Set<string>();
 return markers.flatMap(m=>{const canonical=bySource.get(String(m.findingId));if(!canonical)return [m];const key=damageId(canonical);if(seen.has(key))return [];seen.add(key);return [{...m,findingId:key,reviewStatus:canonical.reviewStatus,position:canonical.worldPosition||m.position}];});
}
