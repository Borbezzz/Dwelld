"use client";

import type { InferenceSession } from "onnxruntime-web";
export type Detection = { objectId: string; label: string; classId: number; confidence: number; boundingBox: { x: number; y: number; width: number; height: number } };
export const MODEL_NAME = "YOLO11n COCO80";
const SIZE = 640;
// Names and indices are the original COCO classes; unsupported furniture is not relabelled.
export const ROOM_CLASSES: Record<number, string> = { 24: "backpack", 26: "handbag", 28: "suitcase", 39: "bottle", 40: "wine glass", 41: "cup", 45: "bowl", 56: "chair", 57: "couch", 58: "potted plant", 59: "bed", 60: "dining table", 61: "toilet", 62: "tv", 63: "laptop", 64: "mouse", 65: "remote", 66: "keyboard", 67: "cell phone", 68: "microwave", 69: "oven", 70: "toaster", 71: "sink", 72: "refrigerator", 73: "book", 74: "clock", 75: "vase", 77: "teddy bear" };
let sessionPromise: Promise<InferenceSession> | undefined;
async function session() {
  if (!sessionPromise) sessionPromise = (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.wasmPaths = "/onnx/";
    ort.env.wasm.numThreads = 1;
    return ort.InferenceSession.create("/models/yolo11n.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  })().catch(error => { sessionPromise = undefined; throw error; });
  return sessionPromise;
}
function iou(a: Detection["boundingBox"], b: Detection["boundingBox"]) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}
/** Decode YOLO [1,84,N] output; reverse centered 640px letterbox into source [0,1] coordinates. */
export function decodeDetections(data: Float32Array, dims: readonly number[], width: number, height: number): Detection[] {
  if (dims.length !== 3 || dims[0] !== 1 || dims[1] !== 84 || data.length !== 84 * dims[2] || width <= 0 || height <= 0) throw new Error("Unexpected YOLO tensor shape");
  const count = dims[2], scale = Math.min(SIZE / width, SIZE / height);
  const resizedWidth = Math.round(width * scale), resizedHeight = Math.round(height * scale);
  const padX = Math.floor((SIZE - resizedWidth) / 2), padY = Math.floor((SIZE - resizedHeight) / 2);
  const result: Detection[] = [];
  for (let i = 0; i < count; i++) {
    let classId = 0, confidence = 0;
    for (let c = 0; c < 80; c++) { const score = data[(c + 4) * count + i]; if (score > confidence) { confidence = score; classId = c; } }
    if (!ROOM_CLASSES[classId] || !Number.isFinite(confidence) || confidence < 0.35 || confidence > 1) continue;
    const cx = data[i], cy = data[count + i], w = data[2 * count + i], h = data[3 * count + i];
    if (![cx, cy, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const x1 = Math.max(0, Math.min(1, (cx - w / 2 - padX) / resizedWidth));
    const y1 = Math.max(0, Math.min(1, (cy - h / 2 - padY) / resizedHeight));
    const x2 = Math.max(0, Math.min(1, (cx + w / 2 - padX) / resizedWidth));
    const y2 = Math.max(0, Math.min(1, (cy + h / 2 - padY) / resizedHeight));
    if (x2 <= x1 || y2 <= y1) continue;
    result.push({ objectId: crypto.randomUUID(), label: ROOM_CLASSES[classId], classId, confidence, boundingBox: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  }
  const kept: Detection[] = [];
  for (const candidate of result.sort((a, b) => b.confidence - a.confidence)) {
    if (!kept.some(other => other.classId === candidate.classId && iou(other.boundingBox, candidate.boundingBox) > 0.45)) kept.push(candidate);
    if (kept.length >= 50) break;
  }
  return kept;
}
export async function detectObjects(image: Blob | HTMLCanvasElement): Promise<Detection[]> {
  const bitmap = image instanceof Blob ? await createImageBitmap(image) : null;
  const source = bitmap || image as HTMLCanvasElement;
  try {
    const width = source.width, height = source.height;
    if (!width || !height) throw new Error("The source frame is empty");
    const canvas = document.createElement("canvas"); canvas.width = SIZE; canvas.height = SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas processing is unavailable");
    context.fillStyle = "rgb(114,114,114)"; context.fillRect(0, 0, SIZE, SIZE);
    const scale = Math.min(SIZE / width, SIZE / height), rw = Math.round(width * scale), rh = Math.round(height * scale);
    context.drawImage(source, Math.floor((SIZE - rw) / 2), Math.floor((SIZE - rh) / 2), rw, rh);
    const pixels = context.getImageData(0, 0, SIZE, SIZE).data, data = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) for (let channel = 0; channel < 3; channel++) data[channel * SIZE * SIZE + i] = pixels[4 * i + channel] / 255;
    const [model, ort] = await Promise.all([session(), import("onnxruntime-web/wasm")]);
    const input = new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]);
    const outputs = await model.run({ [model.inputNames[0]]: input });
    try { const out = outputs[model.outputNames[0]]; return decodeDetections(out.data as Float32Array, out.dims, width, height); }
    finally { input.dispose(); Object.values(outputs).forEach(out => out.dispose()); }
  } finally { bitmap?.close(); }
}
