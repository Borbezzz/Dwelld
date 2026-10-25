/** A LiDAR depth map for one frame, in metres, with optional per-pixel ARKit confidence (0 low, 1 medium, 2 high). */
export type DepthPatch = { data: Float32Array; width: number; height: number; confidence?: Uint8Array };
