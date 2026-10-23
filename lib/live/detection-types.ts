/** All boxes use normalized coordinates relative to the unmirrored source frame. */
export type LiveBox = { x: number; y: number; width: number; height: number };
export type LiveDetection = { objectId: string; label: string; classId: number; confidence: number; boundingBox: LiveBox };
export type TrackedObject = LiveDetection & { firstSeenSeconds: number; lastSeenSeconds: number; observations: number };
export type LiveAnalysisObject = Pick<LiveDetection, 'objectId'|'label'|'classId'|'boundingBox'>;
export type LiveDamageFinding = { id: string; parentObjectId: string|null; label: string; description: string; boundingBox: LiveBox|null; timestampSeconds: number; damageType: string; source: 'ai' };
export type LiveAnalysisResult = { evidenceFrameRef: string; sourceWidth: number; sourceHeight: number; findings: LiveDamageFinding[]; analyzedObjectIds: string[]; surfacesAnalyzed: boolean };
