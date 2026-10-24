import type { Finding } from "@/lib/types";
export type LiveRole = "desktop" | "phone";
export type LiveStatus = "pairing" | "connected" | "recording" | "stopping" | "saved";
export type LiveBox = { x: number; y: number; width: number; height: number };
export interface LiveObject { objectId: string; label: string; classId: number; confidence: number; boundingBox: LiveBox; firstSeenSeconds: number; lastSeenSeconds: number; observations: number; }
export interface NativePose { transform: number[]; intrinsics: number[]; width: number; height: number }
export interface NativeLive { splat?: string; elements?: { id: string; category: string; dimensions: [number, number, number]; transform: number[] }[]; pose?: NativePose; updatedAt?: string }
export interface LiveFinding extends Omit<Finding, "id"> { id: string; parentObjectId?: string | null; evidenceFrameRef?: string; pose?: NativePose; worldPosition?: [number, number, number]; elementId?: string | null; elementCategory?: string; autoApproved?: boolean; confidence?: number; verification?: { verdict: string; confidence: number; reason: string; threshold?: number }; }
export interface InspectionSession { workflow?:{inspectionStatus?:string;reportStatus?:string;reportError?:string;comparisonStatus?:string;comparisonError?:string;searchStatus?:string;searchError?:string}; analysisBatches?:LiveBatch[]; analysisIssue?:{code:string;message:string;at:string}; analysisProgress?: { checked: number; checking: number; queued: number; failed: number }; nativeCapture?:boolean; nativePreview?:string; nativeProgress?:{stage:string;frames:number;depthFrames:number;upload?:number}; nativeLive?:NativeLive; id: string; roomId: string; status: LiveStatus; createdAt: string; expiresAt: string; pairingExpiresAt: string; paired: boolean; phoneLastSeenAt?: string; desktopLastSeenAt?: string; inspectionId?: string; continueFrom?: string; stopRequested: boolean; }
export interface LiveSignal { id: string; eventId: string; type: "offer" | "answer" | "ice" | "restart"; data: unknown; from: LiveRole; }
export interface LiveState { session: InspectionSession; objects: LiveObject[]; findings: LiveFinding[]; signals: LiveSignal[]; }
export interface LiveSessionCreated { sessionId: string; desktopToken: string; pairingToken: string; pairingExpiresAt: string; expiresAt: string; iceServers: RTCIceServer[]; }
export type LiveEventType = "scan.started" | "scan.stop_requested" | "phone.connected" | "phone.disconnected" | "objects.updated" | "finding.reviewed";
export interface LiveEvent { eventId: string; type: LiveEventType; payload?: Record<string, unknown>; }

export interface LiveBatch {id:string;slot:number|null;startSeconds:number;endSeconds:number;frames:number;checked:number;status:'queued'|'checking'|'retrying'|'failed'|'unassessed'|'findings'|'clear';attempt:number;message?:string;evidenceRef:string;timestampSeconds:number;observations:{label:string;description?:string;boundingBox?:LiveBox|null;point?:{x:number;y:number}|null}[];findingCount:number;objects:{id:string;label:string;boundingBox:LiveBox}[];}
