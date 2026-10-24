import type { Finding } from './types';
export function timelineFindings(findings: Finding[]) {
  return findings.filter(f=>f.reviewStatus!=='rejected'&&typeof f.timestampSeconds==='number'&&Number.isFinite(f.timestampSeconds)&&f.timestampSeconds>=0);
}
/** Markers are sampled evidence, not continuous object tracking between frames. */
export function findingsAtTime(findings:Finding[],time:number,tolerance=.4):Finding[] {
  return timelineFindings(findings).flatMap(f=>{
    const source=f.evidenceObservations?.filter(o=>typeof o.timestampSeconds==='number'&&Math.abs(o.timestampSeconds-time)<=tolerance).sort((a,b)=>Math.abs(a.timestampSeconds!-time)-Math.abs(b.timestampSeconds!-time))[0];
    if(source)return [{...f,timestampSeconds:source.timestampSeconds,evidenceFrameUrl:source.evidenceFrameUrl||f.evidenceFrameUrl,boundingBox:source.boundingBox??undefined,point:source.point??undefined}];
    return Math.abs(f.timestampSeconds!-time)<=tolerance?[f]:[];
  });
}
export function timelineGroups(findings:Finding[]) {
  const groups=new Map<number,Finding[]>();
  for(const f of timelineFindings(findings)){const key=Math.round(f.timestampSeconds!*100)/100;groups.set(key,[...(groups.get(key)||[]),f]);}
  return [...groups].sort(([a],[b])=>a-b).map(([time,items])=>({time,items,damage:items.some(f=>f.kind==='damage')}));
}

/** Still-photo boxes require the source timestamp; nearby views can have different camera poses. */
export function findingsForSourceFrame(findings: Finding[], timestamp: number) {
  return findingsAtTime(findings, timestamp, 0.001);
}
