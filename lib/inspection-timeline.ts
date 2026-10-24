import type { Finding } from './types';
export function timelineFindings(findings: Finding[]) {
  return findings.filter(f=>f.reviewStatus!=='rejected'&&typeof f.timestampSeconds==='number'&&Number.isFinite(f.timestampSeconds)&&f.timestampSeconds>=0);
}
/** Markers are sampled evidence, not continuous object tracking between frames. */
export function findingsAtTime(findings:Finding[],time:number,tolerance=.4) {
  return timelineFindings(findings).filter(f=>Math.abs(f.timestampSeconds!-time)<=tolerance);
}
export function timelineGroups(findings:Finding[]) {
  const groups=new Map<number,Finding[]>();
  for(const f of timelineFindings(findings)){const key=Math.round(f.timestampSeconds!*100)/100;groups.set(key,[...(groups.get(key)||[]),f]);}
  return [...groups].sort(([a],[b])=>a-b).map(([time,items])=>({time,items,damage:items.some(f=>f.kind==='damage')}));
}
