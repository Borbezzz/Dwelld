export type Vec3 = [number, number, number];
export interface SpatialElement { id: string; category: string; dimensions: Vec3; transform: number[] }
export interface SpatialFrame { timestamp: number; image: string; depth?: string; confidence?: string; width: number; height: number; depthWidth?: number; depthHeight?: number; intrinsics: number[]; transform: number[] }
export interface SpatialRegistration { sessionId: string; source: "arkit-calibrated" | "manual-calibration"; transform: number[] }
export interface SpatialManifest { version: 1; sessionId: string; coordinateSystem: "arkit-right-handed-y-up-metres"; elements: SpatialElement[]; frames: SpatialFrame[]; assets: { name: string; mediaRef: string; kind: "image" | "depth" | "confidence" | "usdz" | "splat"; registration?: SpatialRegistration; reconstructionMethod?: "lidar-initialized" | "trained" }[] }
export interface SpatialMarker { id: string; position: Vec3; label: string; elementId: string | null; findingId?: string | null; reviewStatus: "pending" | "confirmed" | "rejected"; version: number }
