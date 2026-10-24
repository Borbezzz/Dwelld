/**
 * A 2D picture of vector space: the top two principal components of the stored embeddings,
 * with the query projected into the same plane. Computed on the n×n Gram matrix, so it stays
 * cheap for a room's worth of findings even at 1024 dimensions.
 */
export type MapPoint = { x: number; y: number; similarity: number };

function topEigen(G: number[][], k: number) {
  const n = G.length, vecs: number[][] = [], vals: number[] = [];
  for (let c = 0; c < k; c++) {
    let v = Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898 + c * 78.233) + 1.5);
    let lambda = 0;
    for (let it = 0; it < 120; it++) {
      for (const u of vecs) { const d = u.reduce((s, x, i) => s + x * v[i], 0); v = v.map((x, i) => x - d * u[i]); }
      const w = G.map(row => row.reduce((s, x, j) => s + x * v[j], 0));
      const norm = Math.hypot(...w); if (!norm) break;
      lambda = norm; v = w.map(x => x / norm);
    }
    vecs.push(v); vals.push(lambda);
  }
  return { vecs, vals };
}
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const cosine = (a: number[], b: number[]) => dot(a, b) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);

export function projectMap(vectors: number[][], query?: number[] | null): { points: MapPoint[]; query: MapPoint | null } {
  const n = vectors.length;
  if (n < 3) return { points: vectors.map((v, i) => ({ x: (i - (n - 1) / 2) * .6, y: 0, similarity: query ? cosine(v, query) : 0 })), query: query ? { x: 0, y: .6, similarity: 1 } : null };
  const d = vectors[0].length, mean = Array(d).fill(0);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  const X = vectors.map(v => v.map((x, j) => x - mean[j]));
  const G = X.map(a => X.map(b => dot(a, b)));
  const { vecs, vals } = topEigen(G, 2);
  // Principal axes in embedding space, so the query lands in the same coordinates.
  const axes = vecs.map((u, c) => { const a = Array(d).fill(0); X.forEach((row, i) => { for (let j = 0; j < d; j++) a[j] += row[j] * u[i]; }); const s = Math.sqrt(vals[c]) || 1; return a.map(x => x / s); });
  const coords = (v: number[]) => { const c = v.map((x, j) => x - mean[j]); return [dot(c, axes[0]), dot(c, axes[1])]; };
  const raw = vectors.map(coords), q = query ? coords(query) : null;
  const scale = Math.max(1e-9, ...[...raw, ...(q ? [q] : [])].flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
  return {
    points: raw.map(([x, y], i) => ({ x: x / scale, y: y / scale, similarity: query ? cosine(vectors[i], query) : 0 })),
    query: q ? { x: q[0] / scale, y: q[1] / scale, similarity: 1 } : null,
  };
}
