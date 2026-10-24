/** Cover the entire walkthrough at one-second intervals, including both ends. */
export const MAX_VIDEO_FRAMES = 121;
export function videoSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error('Video must be between zero and 120 seconds');
  const times = Array.from({ length: Math.ceil(duration) }, (_, i) => i);
  const last = Math.max(0, Math.floor((duration - .05) * 1000) / 1000);
  if (last > times[times.length - 1] + .1) times.push(last);
  return times;
}
