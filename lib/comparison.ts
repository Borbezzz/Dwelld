export const CHANGE_TYPES = ["pre_existing", "potentially_new", "missing_or_changed", "no_longer_visible", "uncertain", "unchanged"] as const;
export type ChangeType = typeof CHANGE_TYPES[number];
export interface ComparisonEvidence { id:string; kind:string; label:string; description?:string; timestampSeconds?:number; evidenceFrameUrl?:string; boundingBox?:{x:number;y:number;width:number;height:number}; point?:{x:number;y:number}; }
export interface ComparisonChange { id:string; baselineFindingId:string|null; currentFindingId:string|null; category:ChangeType; explanation:string; comparableView:boolean; reviewStatus:"pending"|"confirmed"|"rejected"; }
export interface ComparisonRecord { id:string; roomId:string; baselineInspectionId:string; currentInspectionId:string; createdAt:string; changes:ComparisonChange[]; baseline:ComparisonEvidence[]; current:ComparisonEvidence[]; warnings:string[]; reviews:{changeId:string;status:string;note:string;at:string}[]; }
/**
 * Model references are constrained to the supplied evidence, and absence never establishes loss.
 * One malformed or invented item no longer sinks the whole comparison: it is dropped and counted.
 */
export function parseComparison(text:string, baseline:Set<string>, current:Set<string>):ComparisonChange[] {
 const data=JSON.parse(text); if(!data||!Array.isArray(data.changes))throw new Error("Invalid comparison response");
 const seen=new Set<string>(),out:ComparisonChange[]=[];
 for(const item of data.changes.slice(0,80) as Record<string,unknown>[]){
  if(!item||!CHANGE_TYPES.includes(item.category as ChangeType)||typeof item.explanation!=="string"||!item.explanation.trim()||item.explanation.length>2000)continue;
  const b=item.baselineFindingId||null,c=item.currentFindingId||null;
  if(!(b===null||(typeof b==="string"&&baseline.has(b)))||!(c===null||(typeof c==="string"&&current.has(c)))||(!b&&!c))continue;
  const key=`${b}|${c}`;if(seen.has(key))continue;seen.add(key);
  const comparableView=item.comparableView===true;
  let category=item.category as ChangeType;
  if((category==="pre_existing"||category==="unchanged")&&(!b||!c))category="uncertain";
  if((category==="missing_or_changed"||category==="no_longer_visible"||category==="potentially_new")&&!comparableView)category="uncertain";
  if((category==="missing_or_changed"||category==="potentially_new")&&!c)category="uncertain";
  if(category==="no_longer_visible"&&!b)category="uncertain";
  out.push({id:`change-${out.length+1}`,baselineFindingId:b as string|null,currentFindingId:c as string|null,category,explanation:item.explanation.trim(),comparableView,reviewStatus:"pending"});
 }
 return out;
}
