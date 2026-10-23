import type { Room, Inspection, Finding, ReviewStatus, SearchFinding, DetectionFrame } from "./types";
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error || `Request failed (${response.status})`); }
  return response.json();
}
export const api = {
  addDamage: (inspectionId: string, body: {description: string; evidenceFindingId: string; point: {x:number;y:number}; objectId?: string|null}) => request<{finding: Finding}>(`/api/inspections/${inspectionId}/findings`, {method:"POST",body:JSON.stringify(body)}),
  search: (query: string, roomId?: string) => request<{results: SearchFinding[]}>(`/api/search?${new URLSearchParams({q:query, ...(roomId ? {roomId} : {})})}`),
  rooms: () => request<{ rooms: Room[] }>("/api/rooms"),
  createRoom: (name: string) => request<{ room: Room }>("/api/rooms", { method: "POST", body: JSON.stringify({ name }) }),
  room: (id: string) => request<{ room: Room }>(`/api/rooms/${id}`),
  inspections: () => request<{ inspections: Inspection[] }>("/api/inspections"),
  createInspection: (roomId: string, videoUrl: string, videoMimeType: string, detectionFrames: DetectionFrame[]) => request<{ inspection: Inspection }>("/api/inspections", { method: "POST", body: JSON.stringify({ roomId, videoUrl, videoMimeType, detectionFrames }) }),
  inspection: (id: string) => request<{ inspection: Inspection; findings: Finding[] }>(`/api/inspections/${id}`),
  review: (inspectionId: string, findingId: string, reviewStatus: ReviewStatus) => request<{ finding: Finding }>(`/api/inspections/${inspectionId}/findings/${findingId}`, { method: "PATCH", body: JSON.stringify({ reviewStatus }) })
};
