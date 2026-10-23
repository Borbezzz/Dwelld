export const CHANGE_TYPES = ["pre_existing", "potentially_new", "missing_or_changed", "no_longer_visible", "uncertain", "unchanged"] as const;
export type ChangeType = typeof CHANGE_TYPES[number];
export interface ComparisonEvidence { id:string; kind:string; label:string; description?:string; timestampSeconds?:number; evidenceFrameUrl?:string; boundingBox?:{x:number;y:number;width:number;height:number}; point?:{x:number;y:number}; }
export interface ComparisonChange { id:string; baselineFindingId:string|null; currentFindingId:string|null; category:ChangeType; explanation:string; comparableView:boolean; reviewStatus:"pending"|"confirmed"|"rejected"; }
export interface ComparisonRecord { id:string; roomId:string; baselineInspectionId:string; currentInspectionId:string; createdAt:string; changes:ComparisonChange[]; baseline:ComparisonEvidence[]; current:ComparisonEvidence[]; warnings:string[]; reviews:{changeId:string;status:string;note:string;at:string}[]; }
/** Model references are constrained to the supplied evidence, and absence never establishes loss. */
export function parseComparison(text:string, baseline:Set<string>, current:Set<string>):ComparisonChange[] {
 const data=JSON.parse(text); if(!data||!Array.isArray(data.changes)||data.changes.length>80)throw new Error("Invalid comparison response");
 const seen=new Set<string>();
 return data.changes.map((item:Record<string,unknown>,index:number)=>{
  if(!item||!CHANGE_TYPES.includes(item.category as ChangeType)||typeof item.explanation!=="string"||!item.explanation.trim()||item.explanation.length>2000||typeof item.comparableView!=="boolean")throw new Error("Invalid comparison observation");
  const b=item.baselineFindingId,c=item.currentFindingId;
  if(!(b===null||(typeof b==="string"&&baseline.has(b)))||!(c===null||(typeof c==="string"&&current.has(c)))||(!b&&!c))throw new Error("Unverified comparison evidence reference");
  const key=`${b}|${c}`;if(seen.has(key))throw new Error("Duplicate comparison observation");seen.add(key);
  let category=item.category as ChangeType;
  if((category==="pre_existing"||category==="unchanged")&&(!b||!c))category="uncertain";
  if((category==="missing_or_changed"||category==="no_longer_visible"||category==="potentially_new")&&!item.comparableView)category="uncertain";
  if((category==="missing_or_changed"||category==="potentially_new")&&!c)category="uncertain";
  if(category==="no_longer_visible"&&!b)category="uncertain";
  return {id:`change-${index+1}`,baselineFindingId:b as string|null,currentFindingId:c as string|null,category,explanation:item.explanation.trim(),comparableView:item.comparableView,reviewStatus:"pending"};
 });
}
