export type ReviewStatus = "pending" | "confirmed" | "rejected";
export interface Finding {
  id: string; kind: "object" | "damage"; label: string; description?: string;
  timestampSeconds?: number; evidenceFrameUrl?: string;
  point?: { x: number; y: number }; source?: "manual" | "ai"; detectionSource?: "yolo" | "gemini" | "crack-model" | "roomplan";
  boundingBox?: { x: number; y: number; width: number; height: number };
  reviewStatus?: ReviewStatus; uncertain?: boolean; objectId?: string | null; spatialElementId?: string | null; damageType?: string | null; confidence?: number | null; autoApproved?: boolean; verification?: { verdict: string; confidence: number; reason: string } | null;
}
export interface Inspection { id: string; captureSource?: string; isOwner?: boolean; virtual?: boolean; segment?: {startTime:number;endTime:number}; type?: "move-in" | "move-out"; roomId: string; status: "queued" | "processing" | "completed" | "partial" | "failed"; analysisWarnings?: string[]; evidenceFrames?: {timestampSeconds:number;url:string}[]; analysisRunId?: string; analysisProgress?:{phase:'extracting'|'checking'|'verifying'|'complete'|'failed';totalFrames:number;processedFrames:number;updatedAt:string}; createdAt: string; videoUrl?: string; videoMimeType?: string; }
export interface Room { id: string; name: string; createdAt: string; spaceId?: string | null; isOwner?: boolean; }
export interface Space { id: string; name: string; createdAt: string; role?: "owner" | "landlord" | "tenant" | "member"; }

export interface SearchFinding { id: string; inspectionId: string; roomId: string; type: "object" | "damage"; label: string; description?: string; timestamp?: number; reviewStatus?: ReviewStatus; score: number; }

export interface ObjectDetection { objectId: string; label: string; boundingBox: {x:number;y:number;width:number;height:number}; classId?: number; confidence?: number; }
export interface DetectionFrame { timestampSeconds: number; detections: ObjectDetection[]; }
