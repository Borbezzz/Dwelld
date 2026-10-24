type Box={x:number;y:number;width:number;height:number};
export type DamageEvidence={evidenceFrameUrl?:string|null;timestampSeconds?:number;boundingBox?:Box|null;point?:{x:number;y:number}|null;worldPosition?:number[]|null;spatialElementId?:string|null;elementId?:string|null;objectId?:unknown;parentDetectionId?:string|null;parentObjectId?:string|null;objectBoundingBox?:Box|null;viewSignature?:string;cropSignature?:string;pose?:{transform:number[]}|null};
export type DamageCandidate=DamageEvidence&{kind?:string;id?:unknown;_id?:unknown;detectionId?:string;label?:string;damageType?:string|null;source?:string;reviewStatus?:string;autoApproved?:boolean;autoRejected?:boolean;inspectionId?:unknown;sessionId?:unknown;ref?:string; evidenceFrameRef?:string;description?:string;evidenceObservations?:DamageEvidence[];sourceObservationIds?:string[]};
export const damageId=(f:DamageCandidate)=>String(f._id??f.id??f.detectionId??'');
export function damageFamily(value:string){const v=value.toLowerCase();return /scratch|scuff|abrasion/.test(v)?'surface-mark':/crack/.test(v)?'crack':/chip/.test(v)?'chip':/dent/.test(v)?'dent':/stain|discolou?r/.test(v)?'stain':/tear|rip/.test(v)?'tear':/hole|puncture/.test(v)?'hole':v.trim();}
const valid=(b?:Box|null)=>!!b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0;
function overlap(a?:Box|null,b?:Box|null){if(!valid(a)||!valid(b))return 0;const area=Math.max(0,Math.min(a!.x+a!.width,b!.x+b!.width)-Math.max(a!.x,b!.x))*Math.max(0,Math.min(a!.y+a!.height,b!.y+b!.height)-Math.max(a!.y,b!.y));return area/(a!.width*a!.height+b!.width*b!.height-area||1);}
function signatureDistance(a?:string,b?:string){if(!a||!b||a.length!==512||b.length!==512||!/^[a-f0-9]+$/.test(a+b))return Infinity;let sum=0;for(let i=0;i<a.length;i+=2)sum+=Math.abs(parseInt(a.slice(i,i+2),16)-parseInt(b.slice(i,i+2),16));return sum/(256*255);}
const ref=(f:DamageCandidate)=>f.evidenceFrameUrl||f.evidenceFrameRef||f.ref;
const owner=(f:DamageCandidate)=>String(f.spatialElementId||f.elementId||f.objectId||f.parentDetectionId||f.parentObjectId||'');
const manualDecision=(f:DamageCandidate)=>['confirmed','rejected'].includes(f.reviewStatus||'')&&!f.autoApproved&&!f.autoRejected;
function relative(f:DamageCandidate){const b=f.boundingBox,o=f.objectBoundingBox;if(!valid(b)||!valid(o))return null;return {x:(b!.x-o!.x)/o!.width,y:(b!.y-o!.y)/o!.height,width:b!.width/o!.width,height:b!.height/o!.height};}
/** Match locations in ONE scan. Labels alone and boxes in different camera views never establish identity. */
export function sameDamage(a:DamageCandidate,b:DamageCandidate){
 if(a.source==='manual'||b.source==='manual'||a.kind&&a.kind!=='damage'||b.kind&&b.kind!=='damage')return false;
 for(const key of ['inspectionId','sessionId'] as const)if(a[key]&&b[key]&&String(a[key])!==String(b[key]))return false;
 if(manualDecision(a)&&manualDecision(b)&&a.reviewStatus!==b.reviewStatus)return false;
 if(damageFamily(a.damageType||a.label||'')!==damageFamily(b.damageType||b.label||''))return false;
 const sameSource=!!ref(a)&&ref(a)===ref(b);
 if(Number.isFinite(a.timestampSeconds)&&Number.isFinite(b.timestampSeconds)&&Math.abs(a.timestampSeconds!-b.timestampSeconds!)<.001&&overlap(a.boundingBox,b.boundingBox)<.3)return false;
 if(sameSource)return overlap(a.boundingBox,b.boundingBox)>=.55;
 const ownerA=owner(a),ownerB=owner(b);if(ownerA&&ownerB&&ownerA!==ownerB)return false;
 const pa=a.worldPosition,pb=b.worldPosition;
 if(ownerA&&ownerA===ownerB&&pa?.length===3&&pb?.length===3&&[...pa,...pb].every(Number.isFinite))return Math.hypot(...pa.map((v,i)=>v-pb[i]))<=.1;
 const gap=Math.min(...[a,...(a.evidenceObservations||[])].map(o=>Math.abs((o.timestampSeconds??Infinity)-(b.timestampSeconds??-Infinity))));
 // Near-static views require both pixel evidence and overlapping source regions.
 if(gap<=6&&signatureDistance(a.viewSignature,b.viewSignature)<=.035&&overlap(a.boundingBox,b.boundingBox)>=.6)return true;
 if(ownerA&&ownerA===ownerB&&gap<=6&&overlap(relative(a),relative(b))>=.65&&signatureDistance(a.cropSignature,b.cropSignature)<=.035&&signatureDistance(a.viewSignature,b.viewSignature)<=.1)return true;
 return false;
}
export function damageEvidence(f:DamageCandidate):DamageEvidence{return {evidenceFrameUrl:ref(f),timestampSeconds:f.timestampSeconds,boundingBox:f.boundingBox,point:f.point,worldPosition:f.worldPosition,spatialElementId:f.spatialElementId||f.elementId,objectBoundingBox:f.objectBoundingBox};}
/** Keep one review identity and every original source view. Never overwrite a person's decision. */
export function canonicalDamageFindings<T extends DamageCandidate>(findings:T[]):(T&{sourceObservationIds?:string[];evidenceObservations?:DamageEvidence[]})[]{
 const groups:T[][]=[];
 for(const finding of findings){const group=finding.kind==='damage'?groups.find(g=>g[0].kind==='damage'&&(sameDamage(g[0],finding)||sameDamage({...g[0],timestampSeconds:g.at(-1)!.timestampSeconds},finding))):undefined;if(group)group.push(finding);else groups.push([finding]);}
 return groups.map(group=>{if(group[0].kind!=='damage'||group[0].source==='manual')return group[0];const chosen=group.find(manualDecision)||group.find(f=>f.reviewStatus==='rejected')||group[0];
  const evidence=new Map<string,DamageEvidence>();for(const f of group)for(const o of [...(f.evidenceObservations||[]),damageEvidence(f)])evidence.set(`${o.evidenceFrameUrl}:${o.timestampSeconds}:${JSON.stringify(o.boundingBox)}`,o);
  return {...chosen,sourceObservationIds:[...new Set(group.flatMap(f=>[damageId(f),...(f.sourceObservationIds||[])]).filter(Boolean))],evidenceObservations:[...evidence.values()]};
 });
}
