import {portraitEvidenceBox,portraitEvidencePoint} from "./evidence-orientation";
import type { SpatialManifest } from '../spatial/types';
import type { Finding } from '../types';
type Asset = SpatialManifest['assets'][number];
export function recordedSegments(assets: Asset[]) {
  return assets.filter(a=>a.kind==='video'&&Number.isFinite(a.startTimeSeconds)&&Number.isFinite(a.durationSeconds)).sort((a,b)=>a.startTimeSeconds!-b.startTimeSeconds!);
}
export function findingsInRecording(findings: Finding[], recording: Asset) {
  const start=recording.startTimeSeconds||0,end=start+(recording.durationSeconds||0);
  return findings.flatMap(f=>{
    const observations=f.evidenceObservations?.filter(o=>typeof o.timestampSeconds==='number'&&o.timestampSeconds>=start&&o.timestampSeconds<end);
    const primary=typeof f.timestampSeconds==='number'&&f.timestampSeconds>=start&&f.timestampSeconds<end;
    if(!primary&&!observations?.length)return [];
    const source=primary?f:observations![0];
    return [{...f,...(!primary?{boundingBox:source.boundingBox??undefined,evidenceFrameUrl:source.evidenceFrameUrl||f.evidenceFrameUrl,point:undefined}:{}),timestampSeconds:source.timestampSeconds!-start,...(observations?{evidenceObservations:observations.map(o=>({...o,timestampSeconds:o.timestampSeconds!-start}))}:{})}];
  });
}

/** Sensor photos and native portrait video share the clockwise rotation used during capture. */
export function nativeVideoFindings(findings:Finding[],frames:{timestamp:number;width:number;height:number}[]) {
 return findings.map(f=>{
  // Manual snapshots may have their own orientation. Keep their original still as evidence.
  const evidenceObservations=f.evidenceObservations?.map(o=>{const frame=f.source==='manual'?undefined:frames.find(frame=>Math.abs(frame.timestamp-(o.timestampSeconds??-1))<.001);return !frame?{...o,boundingBox:undefined}:frame.width>frame.height?{...o,boundingBox:o.boundingBox?portraitEvidenceBox(o.boundingBox):undefined}:o;});
  const frame=f.source==='manual'?undefined:frames.find(frame=>Math.abs(frame.timestamp-(f.timestampSeconds??-1))<.001);
  if(!frame)return {...f,evidenceObservations,boundingBox:undefined,point:undefined};
  return frame.width>frame.height?{...f,evidenceObservations,boundingBox:f.boundingBox?portraitEvidenceBox(f.boundingBox):undefined,point:f.point?portraitEvidencePoint(f.point):undefined}:{...f,evidenceObservations};
 });
}
