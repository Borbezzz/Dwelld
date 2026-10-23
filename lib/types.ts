export type ReviewStatus = "pending" | "confirmed" | "rejected";
export interface Finding {
  id: string; kind: "object" | "damage"; label: string; description?: string;
  timestampSeconds?: number; evidenceFrameUrl?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  reviewStatus?: ReviewStatus; uncertain?: boolean; objectId?: string | null;
}
export interface Inspection { id: string; roomId: string; status: "queued" | "processing" | "completed" | "failed"; createdAt: string; videoUrl?: string; videoMimeType?: string; }
export interface Room { id: string; name: string; createdAt: string; }
