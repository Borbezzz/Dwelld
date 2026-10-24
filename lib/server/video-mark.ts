import type { FramePose, RoomElement } from "./frame-analysis";
import { castIntoRoom } from "./projection";

/**
 * A click on the recorded walkthrough, placed in the 3D room.
 *
 * The phone records the camera image rotated a quarter turn clockwise into a 540×960 portrait video
 * (CIImage .right), scaled to fill. So a point in the portrait video maps back to the camera sensor
 * as x = v, y = 1 − u, in normalized coordinates. The camera pose comes from the saved scan frame
 * nearest in time; its ray is cast into RoomPlan's measured walls, floor and furniture.
 */
export type ScanFrame = FramePose & { timestamp: number; image: string };
export const MAX_POSE_GAP_SECONDS = 1.2;

export function videoToSensor(point: { x: number; y: number }, video: { width: number; height: number }, frame: { width: number; height: number }) {
  const rotated = video.height > video.width && frame.width > frame.height;
  return rotated ? { x: point.y, y: 1 - point.x } : { x: point.x, y: point.y };
}

export function nearestFrame<T extends { timestamp: number }>(frames: T[], scanTime: number) {
  let best: T | null = null;
  for (const f of frames) if (!best || Math.abs(f.timestamp - scanTime) < Math.abs(best.timestamp - scanTime)) best = f;
  return best && Math.abs(best.timestamp - scanTime) <= MAX_POSE_GAP_SECONDS ? best : null;
}

export function placeVideoPoint(frames: ScanFrame[], elements: RoomElement[], scanTime: number, point: { x: number; y: number }, video: { width: number; height: number }) {
  const frame = nearestFrame(frames, scanTime);
  if (!frame) return { error: "No camera position was saved near this moment. Pick a moment a little earlier or later." as const };
  const sensor = videoToSensor(point, video, frame);
  const hit = castIntoRoom(sensor.x, sensor.y, frame, elements);
  if (!hit) return { error: "That spot isn't on a measured wall, floor or piece of furniture. Click directly on the surface." as const };
  return { frame, sensor, element: hit.element, position: hit.point, poseGapSeconds: Math.abs(frame.timestamp - scanTime) };
}
