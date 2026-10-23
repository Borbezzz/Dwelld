import type { Room, Inspection, Finding, ReviewStatus } from "./types";
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error || `Request failed (${response.status})`); }
  return response.json();
}
export const api = {
  rooms: () => request<{ rooms: Room[] }>("/api/rooms"),
  createRoom: (name: string) => request<{ room: Room }>("/api/rooms", { method: "POST", body: JSON.stringify({ name }) }),
  room: (id: string) => request<{ room: Room }>(`/api/rooms/${id}`),
  inspections: () => request<{ inspections: Inspection[] }>("/api/inspections"),
  createInspection: (roomId: string, videoUrl: string, videoMimeType: string) => request<{ inspection: Inspection }>("/api/inspections", { method: "POST", body: JSON.stringify({ roomId, videoUrl, videoMimeType }) }),
  inspection: (id: string) => request<{ inspection: Inspection; findings: Finding[] }>(`/api/inspections/${id}`),
  review: (inspectionId: string, findingId: string, reviewStatus: ReviewStatus) => request<{ finding: Finding }>(`/api/inspections/${inspectionId}/findings/${findingId}`, { method: "PATCH", body: JSON.stringify({ reviewStatus }) })
};
