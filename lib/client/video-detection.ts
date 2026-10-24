import { LiveTracker, cropSignature } from "./live-tracker";
import { videoSampleTimes } from "../video-sampling";
import type { DetectionFrame } from "@/lib/types";

/** Wait for decoding/seeking with cleanup on errors, cancellation, or a stalled browser decoder. */
function waitForVideo(video: HTMLVideoElement, event: string, action: () => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, success);
      video.removeEventListener("error", failure);
      signal?.removeEventListener("abort", abort);
    };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error("This browser could not decode the video. Try an MP4 recording.")); };
    const abort = () => { cleanup(); reject(new DOMException("Video analysis cancelled.", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Video decoding timed out. Try a shorter MP4 video.")); }, 30_000);
    video.addEventListener(event, success, { once: true });
    video.addEventListener("error", failure, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { action(); } catch (error) { cleanup(); reject(error); }
  });
}

export async function detectVideoFrames(file: File, onProgress: (message: string) => void, signal?: AbortSignal): Promise<DetectionFrame[]> {
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(file);
  video.muted = true; video.playsInline = true; video.preload = "auto";
  const canvas = document.createElement("canvas");
  try {
    onProgress("Reading your video…");
    await waitForVideo(video, "loadeddata", () => { video.src = objectUrl; video.load(); }, signal);
    // MediaRecorder WebM often has no duration metadata. Seeking beyond the end makes
    // the browser discover the actual final timestamp from the local file.
    if (!Number.isFinite(video.duration)) {
      await waitForVideo(video, "seeked", () => { video.currentTime = 1e10; }, signal);
    }
    const duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
    if (!Number.isFinite(duration) || duration <= 0 || duration >= 1e9) throw new Error("Could not determine the video duration. Please upload an MP4 video.");
    if (duration > 120) throw new Error("Please choose a walkthrough no longer than 2 minutes.");
    if (!video.videoWidth || !video.videoHeight) throw new Error("No video frames could be decoded from this file.");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Your browser could not prepare the video frames.");
    onProgress("Loading object detector…");
    const { detectObjects } = await import("./detector");
    const timestamps = videoSampleTimes(duration);
    const frames: DetectionFrame[] = [];
    const tracker = new LiveTracker();
    for (const [index, timestampSeconds] of timestamps.entries()) {
      signal?.throwIfAborted();
      onProgress(index === 0 ? `Preparing detector and frame 1 of ${timestamps.length} · first use downloads ~24 MB` : `Finding objects · frame ${index + 1} of ${timestamps.length}`);
      if (Math.abs(video.currentTime - timestampSeconds) > 0.0001) {
        await waitForVideo(video, "seeked", () => { video.currentTime = timestampSeconds; }, signal);
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const detected = await detectObjects(canvas);
      const detections = tracker.update(detected, detected.map(d => cropSignature(canvas, d.boundingBox)), timestampSeconds);
      signal?.throwIfAborted();
      // Keep empty frames: Gemini can still inspect walls, floors and other surfaces.
      frames.push({ timestampSeconds, detections: detections.slice(0, 20).map((detection, detectionIndex) => ({
        ...detection,
      })) });
    }
    return frames;
  } finally {
    video.pause(); video.removeAttribute("src"); video.load();
    canvas.width = 0; canvas.height = 0;
    URL.revokeObjectURL(objectUrl);
  }
}
