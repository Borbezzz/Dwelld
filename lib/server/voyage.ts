import sharp from "sharp";
import { readMedia } from "./media";
import type { Box } from "./damage";

/**
 * Voyage AI by MongoDB, through the Atlas Embedding and Reranking API.
 * The model API key is created in the Atlas UI (Project → AI Models → API keys).
 *  - voyage-multimodal-3.5 puts evidence photos and text queries in one vector space,
 *    so "water stain on the desk" finds the photo even when nobody typed those words.
 *  - rerank-3 reorders the fused hybrid results with a cross-encoder.
 */
const BASE = (process.env.VOYAGE_BASE_URL || "https://ai.mongodb.com/v1").replace(/\/$/, "");
export const VOYAGE_MULTIMODAL_MODEL = process.env.VOYAGE_MULTIMODAL_MODEL || "voyage-multimodal-3.5";
export const VOYAGE_RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL || "rerank-3";
export const IMAGE_DIMENSIONS = 1024;
export const voyageConfigured = () => !!process.env.VOYAGE_API_KEY;

type Content = { type: "text"; text: string } | { type: "image_base64"; image_base64: string };

async function call(path: string, body: unknown, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("Voyage AI is not configured");
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* reported below */ }
  if (!response.ok) throw new Error(`Voyage AI ${response.status}: ${String(json.detail || json.error || text).slice(0, 200)}`);
  return json;
}

function unit(v: number[]) {
  const n = Math.hypot(...v);
  if (!n || !v.every(Number.isFinite)) throw new Error("Voyage embedding invalid");
  return v.map(x => x / n);
}

/** One embedding per input; each input is an interleaved sequence of text and images. */
export async function embedMultimodal(inputs: Content[][], inputType: "query" | "document", timeoutMs?: number): Promise<number[][]> {
  const json = await call("/multimodalembeddings", { inputs: inputs.map(content => ({ content })), model: VOYAGE_MULTIMODAL_MODEL, input_type: inputType }, timeoutMs);
  const data = (json.data as { embedding: number[]; index?: number }[] | undefined) || [];
  if (data.length !== inputs.length) throw new Error("Voyage embedding response incomplete");
  return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => unit(d.embedding));
}

/** A text query in the same space as the evidence photos. */
export async function embedQueryForImages(q: string) {
  return (await embedMultimodal([[{ type: "text", text: q.slice(0, 2000) }]], "query"))[0];
}

/** The damage itself: the evidence photo cropped to the finding's box with some context around it. */
export async function evidenceCrop(ref: string, box?: Box | null): Promise<string> {
  const image = await readMedia(ref, 12 * 1024 * 1024);
  let pipeline = sharp(image, { limitInputPixels: 24_000_000 }).rotate();
  const meta = await sharp(image).rotate().metadata();
  const W = meta.width || 0, H = meta.height || 0;
  if (box && W && H) {
    const pad = 0.35, w = box.width * W, h = box.height * H;
    const left = Math.max(0, Math.floor(box.x * W - w * pad)), top = Math.max(0, Math.floor(box.y * H - h * pad));
    const width = Math.min(W - left, Math.max(64, Math.ceil(w * (1 + 2 * pad)))), height = Math.min(H - top, Math.max(64, Math.ceil(h * (1 + 2 * pad))));
    if (width > 8 && height > 8) pipeline = pipeline.extract({ left, top, width, height });
  }
  const jpeg = await pipeline.resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** Image only: photo search must match what the camera saw, not what a model wrote about it. */
export async function embedEvidence(ref: string, box: Box | null | undefined) {
  const image = await evidenceCrop(ref, box);
  return (await embedMultimodal([[{ type: "image_base64", image_base64: image }]], "document", 30_000))[0];
}

/** Cross-encoder relevance for the top fused candidates. Returns scores aligned to `documents`. */
export async function rerank(query: string, documents: string[]): Promise<number[]> {
  if (!documents.length) return [];
  const json = await call("/rerank", { query, documents: documents.map(d => d.slice(0, 4000)), model: VOYAGE_RERANK_MODEL });
  const rows = ((json.data || json.results) as { index: number; relevance_score: number }[] | undefined) || [];
  const scores = documents.map(() => 0);
  for (const r of rows) if (Number.isInteger(r.index) && r.index >= 0 && r.index < scores.length) scores[r.index] = r.relevance_score;
  return scores;
}
