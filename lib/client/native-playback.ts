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
