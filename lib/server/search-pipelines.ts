import type { Document } from "mongodb";

/**
 * Dwelld's search, all inside MongoDB Atlas on the `findings` collection:
 *  keyword  Atlas Search ($search, fuzzy full-text over label + description)
 *  meaning  Atlas Vector Search over `searchText` with Automated Embedding (autoEmbed, Voyage voyage-4):
 *           Atlas embeds documents on write and the query text at query time. No embedding code in the app.
 *           Falls back to Gemini embeddings (`embedding`, 768-d) when the autoEmbed index is not ready.
 *  photo    Atlas Vector Search over `imageEmbedding`: the evidence photo itself, embedded with
 *           Voyage voyage-multimodal-3.5, so words find pictures.
 *  hybrid   $rankFusion (native reciprocal rank fusion) over all of the above, then Voyage rerank-3.
 */
export const INDEX = { keyword: "findings_search", gemini: "findings_vector", auto: "findings_auto", image: "findings_image" } as const;
export const AUTO_EMBED_MODEL = process.env.ATLAS_AUTO_EMBED_MODEL || "voyage-4";
export const PIPELINE_LABELS: Record<string, string> = {
  keyword: "Atlas Search · keywords",
  meaning: "Vector Search · meaning",
  photo: "Vector Search · photos",
};
export const DEFAULT_WEIGHTS: Record<string, number> = { keyword: 1, meaning: 1, photo: 0.8 };

export function searchText(doc: Document) {
  return [doc.label, doc.damageType && doc.damageType !== doc.label ? doc.damageType : null, doc.description, doc.kind === "object" ? "furniture or fixture" : "damage"]
    .filter(Boolean).join(". ").slice(0, 4000);
}

/** Atlas index definitions, created by POST /api/search/setup or scripts/setup-search-indexes.cjs. */
export function indexDefinitions(imageDimensions = 1024, autoModel = AUTO_EMBED_MODEL) {
  return [
    { name: INDEX.keyword, type: "search", definition: { mappings: { dynamic: false, fields: { label: { type: "string" }, description: { type: "string" }, damageType: { type: "string" }, ownerId: { type: "token" }, roomId: { type: "objectId" } } } } },
    { name: INDEX.gemini, type: "vectorSearch", definition: { fields: [{ type: "vector", path: "embedding", numDimensions: 768, similarity: "cosine" }, { type: "filter", path: "ownerId" }, { type: "filter", path: "roomId" }] } },
    { name: INDEX.auto, type: "vectorSearch", definition: { fields: [{ type: "autoEmbed", modality: "text", path: "searchText", model: autoModel }, { type: "filter", path: "ownerId" }, { type: "filter", path: "roomId" }] } },
    { name: INDEX.image, type: "vectorSearch", definition: { fields: [{ type: "vector", path: "imageEmbedding", numDimensions: imageDimensions, similarity: "cosine" }, { type: "filter", path: "ownerId" }, { type: "filter", path: "roomId" }] } },
  ];
}

export type Scope = { ownerId: string; roomId?: unknown };
const filterOf = (s: Scope) => ({ ownerId: s.ownerId, ...(s.roomId ? { roomId: s.roomId } : {}) });

export function keywordPipeline(q: string, s: Scope, limit: number): Document[] {
  return [
    { $search: { index: INDEX.keyword, compound: { must: [{ text: { query: q, path: ["label", "description", "damageType"], fuzzy: { maxEdits: 1 } } }], filter: [{ equals: { path: "ownerId", value: s.ownerId } }, ...(s.roomId ? [{ equals: { path: "roomId", value: s.roomId } }] : [])] } } },
    { $limit: limit },
  ];
}
/** Automated Embedding: Atlas turns the query text into a vector with the index's Voyage model. */
export function autoEmbedPipeline(q: string, s: Scope, limit: number): Document[] {
  return [{ $vectorSearch: { index: INDEX.auto, path: "searchText", query: { text: q }, numCandidates: Math.max(100, limit * 20), limit, filter: filterOf(s) } }];
}
export function geminiVectorPipeline(vector: number[], s: Scope, limit: number, model: string): Document[] {
  return [{ $vectorSearch: { index: INDEX.gemini, path: "embedding", queryVector: vector, numCandidates: Math.max(100, limit * 20), limit, filter: filterOf(s) } }, { $match: { embeddingModel: model } }];
}
export function photoPipeline(vector: number[], s: Scope, limit: number): Document[] {
  return [{ $vectorSearch: { index: INDEX.image, path: "imageEmbedding", queryVector: vector, numCandidates: Math.max(100, limit * 20), limit, filter: filterOf(s) } }];
}
const HIDDEN = { embedding: 0, imageEmbedding: 0, searchText: 0 };
export function standalone(pipeline: Document[], kind: "search" | "vector"): Document[] {
  return [...pipeline, { $addFields: { score: { $meta: kind === "search" ? "searchScore" : "vectorSearchScore" } } }, { $project: HIDDEN }];
}
/** Native hybrid search: Atlas runs every input pipeline and fuses the ranks (RRF, k = 60). */
export function rankFusionPipeline(pipelines: Record<string, Document[]>, limit: number, weights = DEFAULT_WEIGHTS): Document[] {
  const used = Object.keys(pipelines);
  return [
    { $rankFusion: { input: { pipelines }, combination: { weights: Object.fromEntries(used.map(k => [k, weights[k] ?? 1])) }, scoreDetails: true } },
    { $addFields: { score: { $meta: "score" }, scoreDetails: { $meta: "scoreDetails" } } },
    { $limit: limit },
    { $project: { embedding: 0, imageEmbedding: 0 } },
  ];
}
/** Same RRF as $rankFusion, used only when the cluster rejects the stage (MongoDB below 8.0). */
export function appRankFusion(lists: Record<string, Document[]>, limit: number, weights = DEFAULT_WEIGHTS) {
  const byId = new Map<string, Document>();
  for (const [name, docs] of Object.entries(lists)) docs.forEach((doc, i) => {
    const key = String(doc._id), old = byId.get(key), w = weights[name] ?? 1;
    const details = [...(old?.scoreDetails?.details || []), { inputPipelineName: name, rank: i + 1, weight: w }];
    byId.set(key, { ...(old || doc), score: (old?.score || 0) + w / (60 + i + 1), scoreDetails: { value: (old?.score || 0) + w / (60 + i + 1), details } });
  });
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
/** The pipeline as it is sent to Atlas, with vectors shortened so people can read it. */
export function displayPipeline(p: unknown): unknown {
  if (Array.isArray(p)) return p.every(n => typeof n === "number") && p.length > 16 ? `<${p.length}-dimension query vector>` : p.map(displayPipeline);
  if (p && typeof p === "object") return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === "ownerId" ? "<you>" : displayPipeline(v)]));
  return p;
}
/** Per-pipeline ranks from $rankFusion's scoreDetails. */
export function ranksOf(doc: Document): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of (doc.scoreDetails?.details || []) as { inputPipelineName: string; rank: number | string }[]) if (typeof d.rank === "number") out[d.inputPipelineName] = d.rank;
  return out;
}
