import ffmpeg from "ffmpeg-static";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(args: string[]): Promise<string> {
  if (!ffmpeg) throw new Error("Video frame extraction is unavailable on this platform");
  const executable = ffmpeg;
  return new Promise((resolve, reject) => {
    execFile(executable, ["-nostdin", "-hide_banner", ...args], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error("Could not decode the uploaded video"));
      else resolve(stderr);
    });
  });
}

/** Decode the full source to verify duration, including WebM without duration metadata. */
export async function openVideoFrames(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "dwelld-"));
  const source = join(directory, "source");
  const close = () => rm(directory, { recursive: true, force: true });
  try {
    await writeFile(source, bytes);
    const progress = await run(["-i", source, "-map", "0:v:0", "-an", "-progress", "pipe:2", "-f", "null", "-"]);
    const times = [...progress.matchAll(/out_time_us=(\d+)/g)].map((match) => Number(match[1]) / 1_000_000);
    const durationSeconds = Math.max(...times);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Could not determine the video duration");
    return {
      durationSeconds, close,
      async extract(timestampSeconds: number) {
        if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0 || timestampSeconds >= durationSeconds) throw new Error("Evidence timestamp is outside the source video");
        const output = join(directory, `frame-${timestampSeconds}.png`);
        // Accurate input seek avoids decoding the whole preceding video for every one-second sample.
        // FFmpeg discards frames between the seek point and timestamp, and applies source rotation.
        await run(["-y", "-ss", String(timestampSeconds), "-i", source, "-map", "0:v:0", "-frames:v", "1", output]);
        return readFile(output);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
