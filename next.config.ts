import type { NextConfig } from "next";
const models = { yolo: "./public/models/yolo11n.onnx", crack: "./public/models/crack-seg.onnx" };
const nextConfig: NextConfig = {
  distDir: process.env.DWELLD_DIST_DIR || ".next",
  serverExternalPackages: ["ffmpeg-static", "onnxruntime-node"],
  // Types are checked with `npm run lint` before pushing; skipping them here takes the step out of every deploy.
  typescript: { ignoreBuildErrors: !!process.env.VERCEL },
  // Vercel runs Linux x64. Never ship other platforms' ONNX binaries, GPU providers or the browser runtime in functions.
  outputFileTracingExcludes: {
    "/*": [
      "./node_modules/onnxruntime-node/bin/napi-v6/darwin/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/win32/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_*",
      "./node_modules/onnxruntime-web/**/*",
      "./public/onnx/**/*",
      "./ios/**/*",
      "./docs/**/*",
    ],
    // Route keys match as substrings, so the includes below also reach child routes: trim those back out.
    ...Object.fromEntries(["/spatial/markers", "/spatial/assets", "/report", "/video", "/findings"].map(key => [key, ["./public/models/**/*", "./node_modules/ffmpeg-static/**/*"]])),
  },
  // Only the routes that run a model or FFmpeg get the files.
  outputFileTracingIncludes: {
    "/api/comparisons": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/inspections": ["./node_modules/ffmpeg-static/ffmpeg", models.crack],
    "/api/inspections/[inspectionId]/spatial": [models.crack, models.yolo],
    "/api/live/[sessionId]/spatial": [models.crack, models.yolo],
    "/api/live/[sessionId]/analyze": [models.crack],
  },
};
export default nextConfig;
