import type { Room, Space, Inspection, Finding, ReviewStatus, SearchFinding, DetectionFrame } from "./types";
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error ? `${body.error}${body.requestId ? ` (Request ID: ${body.requestId})` : ""}` : `Request failed (${response.status})`); }
  return response.json();
}
export const api = {
  addDamage: (inspectionId: string, body: {description: string; evidenceFindingId: string; point: {x:number;y:number}; objectId?: string|null}) => request<{finding: Finding}>(`/api/inspections/${inspectionId}/findings`, {method:"POST",body:JSON.stringify(body)}),
  search: (query: string, roomId?: string, mode="text") => request<{results: SearchFinding[]}>(`/api/search?${new URLSearchParams({q:query, mode, ...(roomId ? {roomId} : {})})}`),
  spaces: () => request<{ spaces: Space[] }>("/api/spaces"),
  createSpace: (name: string) => request<{space: Space}>("/api/spaces", {method:"POST",body:JSON.stringify({name})}),
  assignRoomToSpace: (roomId: string, spaceId: string | null) => request<{room: Room}>(`/api/rooms/${roomId}`, {method:"PATCH",body:JSON.stringify({spaceId})}),
  rooms: () => request<{ rooms: Room[] }>("/api/rooms"),
  createRoom: (name: string, spaceId?: string) => request<{ room: Room }>("/api/rooms", { method: "POST", body: JSON.stringify({ name, ...(spaceId ? { spaceId } : {}) }) }),
  room: (id: string) => request<{ room: Room }>(`/api/rooms/${id}`),
  inspections: () => request<{ inspections: Inspection[] }>("/api/inspections"),
  createInspection: (roomId: string, videoUrl: string, videoMimeType: string, detectionFrames: DetectionFrame[], type: "move-in" | "move-out" = "move-in") => request<{ inspection: Inspection }>("/api/inspections", { method: "POST", body: JSON.stringify({ roomId, videoUrl, videoMimeType, detectionFrames, type }) }),
  inspection: (id: string) => request<{ inspection: Inspection; findings: Finding[] }>(`/api/inspections/${id}`),
  review: (inspectionId: string, findingId: string, reviewStatus: ReviewStatus) => request<{ finding: Finding }>(`/api/inspections/${inspectionId}/findings/${findingId}`, { method: "PATCH", body: JSON.stringify({ reviewStatus }) })
};
