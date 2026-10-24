"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, RotateCcw, X } from "lucide-react";
import type { Inspection, Room } from "@/lib/types";
import type { ComparisonRecord, ComparisonEvidence, ChangeType } from "@/lib/comparison";
import "@/app/comparison.css";
import ComparisonSpatial from "./comparison-spatial";
import PixelLoader from "./pixel-loader";
import BrandLogo from "./brand-logo";

async function request<T>(url: string, init?: RequestInit): Promise<T> { const r = await fetch(url, init); const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || "Comparison request failed"); return body; }
const CATEGORY: Record<ChangeType, { label: string; tone: string }> = {
  potentially_new: { label: "Possibly new", tone: "new" }, missing_or_changed: { label: "Missing or changed", tone: "new" },
  pre_existing: { label: "Already there at move-in", tone: "known" }, unchanged: { label: "Unchanged", tone: "calm" },
  no_longer_visible: { label: "No longer visible", tone: "calm" }, uncertain: { label: "Can't tell from the scans", tone: "unsure" },
};
const ORDER: ChangeType[] = ["potentially_new", "missing_or_changed", "uncertain", "pre_existing", "no_longer_visible", "unchanged"];
const ready = (i?: Inspection) => !!i && (i.status === "completed" || i.status === "partial");
const label = (i: Inspection) => `${i.type === "move-out" ? "Move-out" : "Move-in"} · ${new Date(i.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;

function Evidence({ finding, side }: { finding?: ComparisonEvidence; side: string }) {
  return <figure className="compare-evidence"><figcaption>{side}</figcaption>{finding ? <>{finding.evidenceFrameUrl ? <div className="compare-image"><img src={`/api/media?url=${encodeURIComponent(finding.evidenceFrameUrl)}`} alt={`${side}: ${finding.label}`} loading="lazy" />{finding.boundingBox && <span className="compare-box" style={{ left: `${finding.boundingBox.x * 100}%`, top: `${finding.boundingBox.y * 100}%`, width: `${finding.boundingBox.width * 100}%`, height: `${finding.boundingBox.height * 100}%` }} />}{finding.point && <span className="compare-point" style={{ left: `${finding.point.x * 100}%`, top: `${finding.point.y * 100}%` }} />}</div> : <div className="compare-image compare-image-empty">No saved image</div>}<p><b>{finding.label}</b>{finding.description ? ` · ${finding.description}` : ""}</p></> : <div className="compare-image compare-image-empty">Not seen in this scan</div>}</figure>;
}

export default function ComparisonWorkspace({ roomId, baselineId = "", currentId = "" }: { roomId: string; baselineId?: string; currentId?: string }) {
  const [room, setRoom] = useState<Room | null>(null), [inspections, setInspections] = useState<Inspection[] | null>(null);
  const [records, setRecords] = useState<ComparisonRecord[]>([]), [record, setRecord] = useState<ComparisonRecord | null>(null);
  const [baseline, setBaseline] = useState(baselineId), [current, setCurrent] = useState(currentId);
  const [busy, setBusy] = useState(""), [busyAt, setBusyAt] = useState(0), [error, setError] = useState(""), [spatial, setSpatial] = useState<{ baseline: string | null; current: string | null } | null>(null);
  const autoRan = useRef(false);

  const load = useCallback(async () => {
    const [r, a, b] = await Promise.all([request<{ room: Room }>(`/api/rooms/${roomId}`), request<{ inspections: Inspection[] }>(`/api/inspections?roomId=${roomId}`), request<{ comparisons: ComparisonRecord[] }>(`/api/comparisons?roomId=${roomId}`)]);
    setRoom(r.room); setInspections(a.inspections); setRecords(b.comparisons);
    return { inspections: a.inspections, comparisons: b.comparisons };
  }, [roomId]);

  const openComparison = useCallback(async (id: string) => { setError(""); try { const data = await request<{ comparison: ComparisonRecord }>(`/api/comparisons/${id}`); setRecord(data.comparison); setSpatial(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not open comparison"); } }, []);

  const compare = useCallback(async (b: string, c: string) => {
    setBusy("Comparing your two scans with Gemini. This usually takes under a minute"); setBusyAt(Date.now()); setError("");
    try { const { comparison } = await request<{ comparison: ComparisonRecord }>("/api/comparisons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baselineInspectionId: b, currentInspectionId: c }) }); setRecord(comparison); setRecords(r => [comparison, ...r]); }
    catch (e) { setError(e instanceof Error ? e.message : "Comparison failed"); } finally { setBusy(""); }
  }, []);

  // Pick sensible defaults, reuse an earlier comparison of the same pair, otherwise run one automatically.
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const { inspections: list, comparisons } = await load(); if (!active) return;
        const done = list.filter(ready).sort((x, y) => +new Date(x.createdAt) - +new Date(y.createdAt));
        const b = baselineId || done[0]?.id || "", c = currentId || (done.length > 1 ? done[done.length - 1].id : "") || "";
        setBaseline(v => v || b); setCurrent(v => v || c);
        if (autoRan.current || !b || !c || b === c) { if (!autoRan.current && comparisons[0] && !baselineId) { autoRan.current = true; void openComparison(comparisons[0].id); } return; }
        const pending = [b, c].map(id => list.find(i => i.id === id)).filter(i => i && !ready(i));
        if (pending.length) { if (pending.some(i => i!.status === "failed")) { setBusy(""); setError("One of these scans could not be analysed, so it can't be compared."); return; } setBusy("Waiting for your new scan to finish analysing"); setBusyAt(t => t || Date.now()); timer = setTimeout(tick, 5000); return; }
        autoRan.current = true; setBusy("");
        const existing = comparisons.find(x => String(x.baselineInspectionId) === b && String(x.currentInspectionId) === c);
        if (existing) void openComparison(existing.id); else void compare(b, c);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Could not load this room"); }
    };
    void tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [load, baselineId, currentId, compare, openComparison]);

  async function review(changeId: string, status: string) {
    if (!record) return; setError("");
    try { const { comparison } = await request<{ comparison: ComparisonRecord }>(`/api/comparisons/${record.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeId, status, note: "" }) }); setRecord(comparison); setRecords(rs => rs.map(r => r.id === comparison.id ? comparison : r)); }
    catch (e) { setError(e instanceof Error ? e.message : "Review failed"); }
  }

  const done = (inspections || []).filter(ready);
  const counts = record ? ORDER.map(k => [k, record.changes.filter(c => c.category === k).length] as const).filter(([, n]) => n) : [];
  const changes = record ? [...record.changes].sort((x, y) => ORDER.indexOf(x.category) - ORDER.indexOf(y.category)) : [];

  return <main className="live-shell comparison-page">
    <header className="live-topbar"><BrandLogo linked compact /><div className="session-breadcrumb"><span>{room?.name || "Room"}</span><i /> <b>What changed</b></div></header>
    <div className="workspace-heading"><div><Link href={`/rooms/${roomId}`} className="back-link"><ArrowLeft size={14} aria-hidden="true" /> {room?.name || "Back to the room"}</Link><h1>What changed?</h1><p>Your move-in and move-out scans, side by side. Confirm what looks right and dismiss what doesn&apos;t.</p></div></div>
    <div className="compare-selection">
      <label>Earlier scan<select className="field" value={baseline} disabled={!!busy} onChange={e => { setBaseline(e.target.value); setRecord(null); }}><option value="">Choose a scan</option>{done.map(i => <option value={i.id} key={i.id}>{label(i)}</option>)}</select></label>
      <label>Later scan<select className="field" value={current} disabled={!!busy} onChange={e => { setCurrent(e.target.value); setRecord(null); }}><option value="">Choose a scan</option>{done.filter(i => i.id !== baseline).map(i => <option value={i.id} key={i.id}>{label(i)}</option>)}</select></label>
      <button className="button button-dark" disabled={!!busy || !baseline || !current} onClick={() => void compare(baseline, current)}>{record && record.baselineInspectionId === baseline && record.currentInspectionId === current ? "Compare again" : "Compare"}</button>
    </div>
    {inspections && done.length < 2 && !busy && <div className="compare-empty"><p>Compare needs two finished scans of this room.</p><Link className="button button-dark" href={done[0] ? `/live?room=${roomId}&type=move-out&baseline=${done[0].id}` : `/live?room=${roomId}&type=move-in`}>{done[0] ? "Scan again to compare" : "Start the move-in scan"}</Link></div>}
    {busy && <PixelLoader label={busy} startedAt={busyAt} />}
    {error && <div role="alert" className="notice error-notice">{error}<button onClick={() => setError("")} aria-label="Dismiss message"><X size={16} /></button></div>}
    {records.length > 1 && <nav className="room-scans" aria-label="Saved comparisons">{records.slice(0, 8).map(r => <button key={r.id} aria-pressed={record?.id === r.id} onClick={() => void openComparison(r.id)}><b>Comparison</b><span>{new Date(r.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></button>)}</nav>}
    {record && <>
      <section className="compare-summary" aria-label="Summary">{counts.length ? counts.map(([k, n]) => <span key={k} className={`compare-tag tone-${CATEGORY[k].tone}`}><b>{n}</b> {CATEGORY[k].label}</span>) : <span>No differences were proposed. That is not proof the room is unchanged.</span>}</section>
      {changes.map(change => <article className={`compare-change tone-${CATEGORY[change.category].tone}`} key={change.id}>
        <header><span className={`compare-tag tone-${CATEGORY[change.category].tone}`}>{CATEGORY[change.category].label}</span><span className="compare-status">{change.reviewStatus === "confirmed" ? "Confirmed" : change.reviewStatus === "rejected" ? "Dismissed" : change.comparableView ? "Needs your review" : "Views not directly comparable"}</span></header>
        <p className="compare-explanation">{change.explanation}</p>
        <div className="compare-pair"><Evidence side="Move-in" finding={record.baseline.find(f => f.id === change.baselineFindingId)} /><Evidence side="Move-out" finding={record.current.find(f => f.id === change.currentFindingId)} /></div>
        <div className="compare-actions">{change.reviewStatus === "pending" ? <><button className="text-button" onClick={() => void review(change.id, "confirmed")}><Check size={14} /> Confirm</button><button className="text-button" onClick={() => void review(change.id, "rejected")}><X size={14} /> Dismiss</button></> : <button className="text-button" onClick={() => void review(change.id, "pending")}><RotateCcw size={13} /> Undo</button>}<button className="text-button" onClick={() => setSpatial({ baseline: change.baselineFindingId, current: change.currentFindingId })}>Show in 3D</button></div>
      </article>)}
      {record.warnings.length > 0 && <details className="compare-notes"><summary>About this comparison</summary>{record.warnings.map(w => <p key={w}>{w}</p>)}</details>}
      <ComparisonSpatial baselineInspectionId={record.baselineInspectionId} currentInspectionId={record.currentInspectionId} baselineFindingId={spatial?.baseline} currentFindingId={spatial?.current} />
    </>}
  </main>;
}
