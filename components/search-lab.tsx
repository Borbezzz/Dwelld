"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle, Search, Database, RefreshCw } from "lucide-react";
import type { Room } from "@/lib/types";

type Box = { x: number; y: number; width: number; height: number };
type Hit = { id: string; inspectionId: string; roomId: string; type: string; label: string; description?: string; damageType?: string; reviewStatus?: string; evidenceFrameUrl?: string; boundingBox?: Box; score?: number; rerankScore?: number; ranks?: Record<string, number> };
type Pipeline = { name: string; label: string; index: string; engine: string; results: Hit[]; query: unknown };
type SearchOut = { engine: string; reranked: boolean; notes: string[]; fusionQuery?: unknown; results: Hit[]; pipelines: Pipeline[] } | { error: string };
type MapPoint = { id: string; inspectionId: string; label: string; kind: string; damageType?: string; reviewStatus?: string; evidenceFrameUrl?: string; boundingBox?: Box; x: number; y: number; similarity: number };
type MapOut = { space: string; photo: boolean; query: { x: number; y: number } | null; points: MapPoint[] } | { error: string };
type Status = { indexes: Record<string, { status: string; queryable: boolean; type: string }>; version: string; rankFusion: boolean | null; voyage: boolean; gemini: boolean; models: { autoEmbed: string; photo: string; rerank: string; gemini: string; weights: Record<string, number> }; counts: { total: number; searchText: number; geminiVectors: number; photoVectors: number } };

const INDEXES = [
  { name: "findings_search", what: "Atlas Search", detail: "fuzzy keywords over label, description and damage type" },
  { name: "findings_auto", what: "Automated Embedding", detail: "Atlas embeds searchText itself with Voyage" },
  { name: "findings_image", what: "Vector Search · photos", detail: "Voyage multimodal vectors of each evidence photo" },
  { name: "findings_vector", what: "Vector Search · Gemini", detail: "gemini-embedding-001 fallback for meaning" },
];
const COLORS: Record<string, string> = { keyword: "#364b40", meaning: "#c8755b", photo: "#8a6fb0" };
const SHORT: Record<string, string> = { keyword: "Keywords", meaning: "Meaning", photo: "Photos" };

/** The evidence photo cropped to the finding, drawn with CSS so no extra request is needed. */
function Crop({ hit, size = 64 }: { hit: { evidenceFrameUrl?: string; boundingBox?: Box; label: string }; size?: number }) {
  if (!hit.evidenceFrameUrl) return <span className="lab-crop lab-crop-empty" style={{ width: size, height: size }} aria-hidden="true" />;
  const b = hit.boundingBox, pad = .25;
  const box = b ? { x: Math.max(0, b.x - b.width * pad), y: Math.max(0, b.y - b.height * pad), w: Math.min(1, b.width * (1 + 2 * pad)), h: Math.min(1, b.height * (1 + 2 * pad)) } : { x: 0, y: 0, w: 1, h: 1 };
  const w = Math.min(box.w, 1 - box.x), h = Math.min(box.h, 1 - box.y);
  const pos = (v: number, s: number) => (s >= .999 ? 0 : (v / (1 - s)) * 100);
  return <span role="img" aria-label={`Evidence photo: ${hit.label}`} className="lab-crop" style={{ width: size, height: size, backgroundImage: `url(/api/media?url=${encodeURIComponent(hit.evidenceFrameUrl)})`, backgroundSize: `${100 / w}% ${100 / h}%`, backgroundPosition: `${pos(box.x, w)}% ${pos(box.y, h)}%` }} />;
}

function RankBars({ ranks, weights }: { ranks?: Record<string, number>; weights: Record<string, number> }) {
  const parts = Object.entries(ranks || {}).map(([name, rank]) => ({ name, rank, v: (weights[name] ?? 1) / (60 + rank) }));
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  return <div className="lab-rankbars">
    <div className="lab-bar" aria-hidden="true">{parts.map(p => <span key={p.name} style={{ width: `${(p.v / total) * 100}%`, background: COLORS[p.name] || "#999" }} />)}</div>
    <div className="lab-ranks">{parts.length ? parts.map(p => <span key={p.name} style={{ color: COLORS[p.name] }}>{SHORT[p.name] || p.name} #{p.rank}</span>) : <span>single pipeline</span>}</div>
  </div>;
}

function SemanticMap({ map }: { map: Extract<MapOut, { points: MapPoint[] }> }) {
  const [hover, setHover] = useState<MapPoint | null>(null);
  const W = 720, H = 420, P = 36;
  const sx = (x: number) => P + (x + 1) / 2 * (W - 2 * P), sy = (y: number) => P + (1 - (y + 1) / 2) * (H - 2 * P);
  const nearest = useMemo(() => map.query ? [...map.points].sort((a, b) => b.similarity - a.similarity).slice(0, 5) : [], [map]);
  if (map.points.length < 2) return <p className="lab-muted">Prepare some findings first. The map needs a few embedded findings to draw.</p>;
  return <div className="lab-map">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of ${map.points.length} findings in vector space`}>
      <rect x="0" y="0" width={W} height={H} fill="#f3f3ec" />
      {[0.25, .5, .75].map(t => <g key={t}><line x1={P + t * (W - 2 * P)} x2={P + t * (W - 2 * P)} y1={P} y2={H - P} stroke="#e2e4dc" /><line y1={P + t * (H - 2 * P)} y2={P + t * (H - 2 * P)} x1={P} x2={W - P} stroke="#e2e4dc" /></g>)}
      {map.query && nearest.map(p => <line key={p.id} x1={sx(map.query!.x)} y1={sy(map.query!.y)} x2={sx(p.x)} y2={sy(p.y)} stroke="#c8755b" strokeOpacity={.25 + .6 * Math.max(0, p.similarity)} strokeDasharray="4 3" />)}
      {map.points.map(p => <circle key={p.id} cx={sx(p.x)} cy={sy(p.y)} r={nearest.includes(p) ? 7 : 4.5} fill={p.kind === "damage" ? "#c8755b" : "#7f9a84"} stroke="#fff" strokeWidth="1.5" opacity={map.query && !nearest.includes(p) ? .55 : 1} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}><title>{p.label}</title></circle>)}
      {map.query && <g transform={`translate(${sx(map.query.x)},${sy(map.query.y)})`}><path d="M0,-11 L3,-3 L11,-3 L4.5,2 L7,10 L0,5 L-7,10 L-4.5,2 L-11,-3 L-3,-3 Z" fill="#202723" /><text x="14" y="4" fontSize="12" fill="#202723">your search</text></g>}
    </svg>
    <div className="lab-map-side">
      {hover ? <div><Crop hit={hover} size={140} /><b>{hover.label}</b><small>{hover.kind}{hover.damageType ? ` · ${hover.damageType}` : ""}{map.query ? ` · similarity ${hover.similarity.toFixed(2)}` : ""}</small></div>
        : map.query ? <div><p className="lab-kicker">Closest to your words</p>{nearest.map(p => <Link key={p.id} href={`/inspections/${p.inspectionId}?finding=${p.id}`} className="lab-near"><Crop hit={p} size={44} /><span><b>{p.label}</b><small>{p.similarity.toFixed(2)}</small></span></Link>)}</div>
          : <p className="lab-muted">Hover a dot to see its photo. Search to drop your words onto the map.</p>}
      <p className="lab-legend"><span style={{ background: "#c8755b" }} />damage <span style={{ background: "#7f9a84" }} />furniture</p>
      <p className="lab-muted">Space: {map.space}. Each dot is one finding, placed by its embedding (first two principal components). Closer means more alike.</p>
    </div>
  </div>;
}

export default function SearchLab({ rooms }: { rooms: Room[] }) {
  const [status, setStatus] = useState<Status | null>(null), [statusError, setStatusError] = useState("");
  const [query, setQuery] = useState(""), [roomId, setRoomId] = useState("");
  const [search, setSearch] = useState<SearchOut | null>(null), [map, setMap] = useState<MapOut | null>(null);
  const [busy, setBusy] = useState(""), [message, setMessage] = useState("");
  async function loadStatus() { try { const r = await fetch("/api/search/setup"), b = await r.json(); if (!r.ok) throw new Error(b.error); setStatus(b); setStatusError(""); } catch (e) { setStatusError(e instanceof Error ? e.message : "Status unavailable"); } }
  async function explore(q: string) {
    setBusy("search");
    try { const r = await fetch(`/api/search/explore?${new URLSearchParams({ q, ...(roomId ? { roomId } : {}) })}`), b = await r.json(); if (!r.ok) throw new Error(b.error); setSearch(b.search); setMap(b.map); }
    catch (e) { setSearch({ error: e instanceof Error ? e.message : "Search failed" }); } finally { setBusy(""); }
  }
  useEffect(() => { void loadStatus(); void explore(""); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function action(kind: "indexes" | "prepare") {
    setBusy(kind); setMessage(kind === "indexes" ? "Sending index definitions to Atlas…" : "Preparing findings: search text, Gemini vectors and Voyage photo vectors…");
    try { const r = await fetch(`/api/search/setup?action=${kind}`, { method: "POST" }), b = await r.json(); if (!r.ok) throw new Error(b.error); setStatus(b); setMessage(kind === "indexes" ? `Submitted. ${Object.entries(b.submitted as Record<string, string>).filter(([, v]) => v !== "submitted").map(([k, v]) => `${k} ${v}`).join("; ") || "Atlas builds them in the background, usually within a minute."}` : `${b.prepared.indexed} findings prepared, ${b.prepared.remaining} remaining.`); if (kind === "prepare") void explore(query); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
  }
  function submit(e: FormEvent) { e.preventDefault(); if (query.trim().length >= 2) void explore(query.trim()); }
  const weights = status?.models.weights || { keyword: 1, meaning: 1, photo: .8 };
  const ok = search && "results" in search;

  return <section className="search-lab">
    <div className="lab-intro"><p className="eyebrow">SEARCH THE EVIDENCE</p><h1>Ask for damage in your own words.</h1><p>Every search runs inside MongoDB Atlas: keywords, meaning and the photos themselves are ranked separately, then fused with <code>$rankFusion</code> and reranked by Voyage.</p></div>

    <div className="lab-status" aria-label="Atlas search status">
      <div className="lab-status-head"><Database size={16} /><b>MongoDB Atlas</b>{status && <span>v{status.version}{status.rankFusion ? " · $rankFusion supported" : status.rankFusion === false ? " · $rankFusion needs 8.0+" : ""}</span>}<button className="lab-icon" onClick={() => void loadStatus()} aria-label="Refresh status"><RefreshCw size={14} /></button></div>
      {statusError && <p className="notice error-notice">{statusError}</p>}
      <div className="lab-indexes">{INDEXES.map(i => { const s = status?.indexes[i.name]; const state = !status ? "…" : !s ? "missing" : s.queryable ? "READY" : s.status; return <div key={i.name} className={`lab-index ${s?.queryable ? "ready" : ""}`}><span className="lab-dot" /><div><b>{i.what}</b><code>{i.name}</code><small>{i.detail}</small></div><em>{state}</em></div>; })}</div>
      {status && <p className="lab-counts">{status.counts.total} findings · {status.counts.searchText} with search text (auto-embedded by Atlas) · {status.counts.geminiVectors} Gemini vectors · {status.counts.photoVectors} Voyage photo vectors{!status.voyage && " · VOYAGE_API_KEY not set, photo search and rerank off"}</p>}
      <div className="lab-actions"><button className="button" disabled={!!busy} onClick={() => void action("indexes")}>{busy === "indexes" ? <LoaderCircle size={15} className="spin" /> : null}Create or update indexes</button><button className="button" disabled={!!busy} onClick={() => void action("prepare")}>{busy === "prepare" ? <LoaderCircle size={15} className="spin" /> : null}Prepare my findings</button><span role="status">{message}</span></div>
    </div>

    <form className="lab-form" onSubmit={submit}>
      <label><span className="field-label">Describe what you’re looking for</span><input className="field" value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. marks on the desk, something sticky, a hole in the door" maxLength={200} /></label>
      <label><span className="field-label">Room</span><select className="field" value={roomId} onChange={e => setRoomId(e.target.value)}><option value="">All rooms</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <button className="button button-dark" disabled={busy === "search" || query.trim().length < 2}>{busy === "search" ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}Search</button>
    </form>

    {search && "error" in search && <p className="notice error-notice">{search.error}</p>}
    {ok && <>
      <div className="lab-engine"><span>{search.engine}</span>{search.reranked && <span>then Voyage {status?.models.rerank || "rerank"}</span>}{search.notes.map(n => <span key={n} className="lab-note">{n}</span>)}</div>
      <div className="lab-results">
        <div className="lab-fused"><p className="lab-kicker">Fused result</p>{search.results.length ? search.results.map((h, i) => <Link key={h.id} className="lab-hit" href={`/inspections/${h.inspectionId}?finding=${h.id}`}><span className="lab-pos">{i + 1}</span><Crop hit={h} /><span className="lab-hit-main"><b>{h.label}</b>{h.description && <small>{h.description}</small>}<RankBars ranks={h.ranks} weights={weights} /></span>{h.rerankScore != null && <span className="lab-score" title="Voyage rerank relevance">{h.rerankScore.toFixed(2)}</span>}</Link>) : <p className="lab-muted">No matches.</p>}</div>
        <div className="lab-columns">{search.pipelines.map(p => <div key={p.name} className="lab-col"><p className="lab-kicker" style={{ color: COLORS[p.name] }}>{p.label}</p><small className="lab-muted">{p.engine}</small><ol>{p.results.slice(0, 6).map(h => <li key={h.id}><Crop hit={h} size={34} /><span>{h.label}</span><em>{h.score != null ? h.score.toFixed(3) : ""}</em></li>)}</ol>{!p.results.length && <p className="lab-muted">Nothing from this pipeline.</p>}</div>)}</div>
      </div>
      <details className="lab-query"><summary>The query Atlas ran</summary><pre>{JSON.stringify(search.fusionQuery || search.pipelines[0]?.query, null, 2)}</pre>{search.fusionQuery ? search.pipelines.map(p => <div key={p.name}><p className="lab-kicker">{p.label} on its own</p><pre>{JSON.stringify(p.query, null, 2)}</pre></div>) : null}</details>
    </>}

    <div className="lab-map-wrap"><p className="lab-kicker">Vector space</p><h2>Where your findings sit by meaning</h2>{map && "error" in map ? <p className="notice error-notice">{map.error}</p> : map ? <SemanticMap map={map} /> : <p className="lab-muted">Loading…</p>}</div>
  </section>;
}
