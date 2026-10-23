import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  distDir: process.env.DWELLD_DIST_DIR || ".next",
  serverExternalPackages: ["ffmpeg-static", "onnxruntime-node"],
  // Vercel runs Linux. Do not package unused Windows/macOS ONNX native binaries.
  ...(process.env.VERCEL ? { outputFileTracingExcludes: {
    "/*": ["./node_modules/onnxruntime-node/bin/napi-v6/darwin/**/*", "./node_modules/onnxruntime-node/bin/napi-v6/win32/**/*"],
  } } : {}),
  outputFileTracingIncludes: {
    "/api/comparisons": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/inspections": ["./node_modules/ffmpeg-static/ffmpeg", "./public/models/crack-seg.onnx"],
    "/api/inspections/*/spatial": ["./public/models/crack-seg.onnx", "./public/models/yolo11n.onnx"],
    "/api/live/*/spatial": ["./public/models/crack-seg.onnx", "./public/models/yolo11n.onnx"],
    "/api/live/*/analyze": ["./public/models/crack-seg.onnx"],
  },
};
export default nextConfig;
