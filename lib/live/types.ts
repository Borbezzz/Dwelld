import type { Finding } from "@/lib/types";
export type LiveRole = "desktop" | "phone";
export type LiveStatus = "pairing" | "connected" | "recording" | "stopping" | "saved";
export type LiveBox = { x: number; y: number; width: number; height: number };
export interface LiveObject { objectId: string; label: string; classId: number; confidence: number; boundingBox: LiveBox; firstSeenSeconds: number; lastSeenSeconds: number; observations: number; }
export interface LiveFinding extends Omit<Finding, "id"> { id: string; parentObjectId?: string | null; evidenceFrameRef?: string; }
export interface InspectionSession { id: string; roomId: string; status: LiveStatus; createdAt: string; expiresAt: string; pairingExpiresAt: string; paired: boolean; phoneLastSeenAt?: string; desktopLastSeenAt?: string; inspectionId?: string; stopRequested: boolean; }
export interface LiveSignal { id: string; eventId: string; type: "offer" | "answer" | "ice" | "restart"; data: unknown; from: LiveRole; }
export interface LiveState { session: InspectionSession; objects: LiveObject[]; findings: LiveFinding[]; signals: LiveSignal[]; }
export interface LiveSessionCreated { sessionId: string; desktopToken: string; pairingToken: string; pairingExpiresAt: string; expiresAt: string; iceServers: RTCIceServer[]; }
export type LiveEventType = "scan.started" | "scan.stop_requested" | "phone.connected" | "phone.disconnected" | "objects.updated" | "finding.reviewed";
export interface LiveEvent { eventId: string; type: LiveEventType; payload?: Record<string, unknown>; }
