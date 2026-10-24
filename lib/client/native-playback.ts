import {portraitEvidenceBox,portraitEvidencePoint} from "./evidence-orientation";
import type { SpatialManifest } from '../spatial/types';
import type { Finding } from '../types';
type Asset = SpatialManifest['assets'][number];
export function recordedSegments(assets: Asset[]) {
  return assets.filter(a=>a.kind==='video'&&Number.isFinite(a.startTimeSeconds)&&Number.isFinite(a.durationSeconds)).sort((a,b)=>a.startTimeSeconds!-b.startTimeSeconds!);
}
export function findingsInRecording(findings: Finding[], recording: Asset) {
  const start=recording.startTimeSeconds||0,end=start+(recording.durationSeconds||0);
  return findings.filter(f=>typeof f.timestampSeconds==='number'&&f.timestampSeconds>=start&&f.timestampSeconds<end).map(f=>({...f,timestampSeconds:f.timestampSeconds!-start}));
}

/** Sensor photos and native portrait video share the clockwise rotation used during capture. */
export function nativeVideoFindings(findings:Finding[],frames:{timestamp:number;width:number;height:number}[]) {
 return findings.map(f=>{
  // Manual snapshots may have their own orientation. Keep their original still as evidence.
  const frame=f.source==='manual'?undefined:frames.find(frame=>Math.abs(frame.timestamp-(f.timestampSeconds??-1))<.001);
  if(!frame)return {...f,boundingBox:undefined,point:undefined};
  return frame.width>frame.height?{...f,boundingBox:f.boundingBox?portraitEvidenceBox(f.boundingBox):undefined,point:f.point?portraitEvidencePoint(f.point):undefined}:f;
 });
}
