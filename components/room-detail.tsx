"use client";
import Link from "next/link";
import DotField from "./dot-field";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import BrandLogo from "./brand-logo";
import EvidenceViewer, { type EvidenceItem } from "./evidence-viewer";
import type { Finding, Inspection, Room } from "@/lib/types";
import type { SpatialManifest, SpatialMarker } from "@/lib/spatial/types";
import { furnitureNames, isFurniture, isFurnitureLabel } from "@/lib/spatial/furniture";
const SpatialViewer = dynamic(() => import("./spatial-viewer"), { ssr: false, loading: () => <div className="room-scene"><div className="room-scene-loading is-live"><DotField /><p>Loading your room in 3D…</p></div></div> });

type Capture = { capture: { manifest: SpatialManifest } | null; markers: SpatialMarker[] };
type Damage = { id: string; label: string; description?: string; status: string; source: string; evidence?: string; findingId?: string; box?: Finding["boundingBox"] | null; point?: Finding["point"] | null; timestampSeconds?: number; confidence?: number | null; autoApproved?: boolean; verification?: Finding["verification"] };
const SOURCE = (f?: Finding) => !f ? "Marked by you" : f.source === "manual" ? "Marked by you" : f.detectionSource === "crack-model" ? "Crack model + Gemini check" : "Gemini 4 Argon";
const fromFinding = (f: Finding): Partial<Damage> => ({ box: f.boundingBox, point: f.point, timestampSeconds: f.timestampSeconds, confidence: f.confidence, autoApproved: f.autoApproved, verification: f.verification });
const ready = (i: Inspection) => i.status === "completed" || i.status === "partial";
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const purpose = (i: Inspection) => i.type === "move-out" ? "Move-out" : "Move-in";

/** A room's home: its latest scan as one 3D space, with every finding described beside it. */
export default function RoomDetail({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<Room | null>(null), [scans, setScans] = useState<Inspection[] | null>(null), [error, setError] = useState("");
  const [current, setCurrent] = useState(""), [capture, setCapture] = useState<Capture | null>(null), [findings, setFindings] = useState<Finding[]>([]), [loadingScan, setLoadingScan] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [hovered, setHovered] = useState<string | null>(null), [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState<"" | "scan" | "room">(""), [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const loadScans = useCallback(async () => {
    const [r, list] = await Promise.all([api.room(roomId), fetch(`/api/inspections?roomId=${roomId}`).then(async res => { const b = await res.json(); if (!res.ok) throw new Error(b.error || "Could not load scans"); return b.inspections as Inspection[]; })]);
    setRoom(r.room); setScans(list);
    setCurrent(c => c && list.some(i => i.id === c) ? c : (list.find(ready) || list[0])?.id || "");
  }, [roomId]);
  useEffect(() => { loadScans().catch(e => setError(e.message)); }, [loadScans]);
  // Keep polling while a scan is still being analysed.
  useEffect(() => { if (!scans?.some(i => i.status === "processing" || i.status === "queued")) return; const t = setInterval(() => { void loadScans().catch(() => {}); }, 6000); return () => clearInterval(t); }, [scans, loadScans]);

  const scan = scans?.find(i => i.id === current);
  useEffect(() => {
    if (!current) { setCapture(null); setFindings([]); return; }
    let active = true; setLoadingScan(true); setSelected(null);
    Promise.all([fetch(`/api/inspections/${current}/spatial`).then(r => r.ok ? r.json() as Promise<Capture> : { capture: null, markers: [] }), api.inspection(current)])
      .then(([c, d]) => { if (!active) return; setCapture(c); setFindings(d.findings); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoadingScan(false); });
    return () => { active = false; };
  }, [current, scan?.status]);

  const manifest = capture?.capture?.manifest;
  const furniture = useMemo(() => manifest?.elements.filter(isFurniture) || [], [manifest]);
  const names = useMemo(() => furnitureNames(furniture), [furniture]);
  const { byElement, elsewhere } = useMemo(() => {
    const byElement = new Map<string, Damage[]>(), elsewhere: Damage[] = [];
    const objectElement = new Map(findings.filter(f => f.kind === "object" && f.spatialElementId).map(f => [f.id, f.spatialElementId!]));
    const markerFor = new Set<string>();
    for (const m of capture?.markers || []) {
      if (m.findingId) markerFor.add(m.findingId);
      const linked = m.findingId ? findings.find(f => f.id === m.findingId) : undefined;
      const d: Damage = { id: `marker-${m.id}`, label: linked?.label || "Marked damage", description: linked?.description || m.label, status: linked?.reviewStatus || m.reviewStatus, source: SOURCE(linked), evidence: linked?.evidenceFrameUrl, findingId: linked?.id, ...(linked ? fromFinding(linked) : {}) };
      if (m.elementId && furniture.some(e => e.id === m.elementId)) byElement.set(m.elementId, [...byElement.get(m.elementId) || [], d]); else elsewhere.push(d);
    }
    for (const f of findings) {
      if (f.kind !== "damage" || markerFor.has(f.id)) continue;
      const d: Damage = { id: f.id, label: f.label, description: f.description, status: f.reviewStatus || "pending", source: SOURCE(f), evidence: f.evidenceFrameUrl, findingId: f.id, ...fromFinding(f) };
      const element = f.spatialElementId || (f.objectId ? objectElement.get(f.objectId) : undefined);
      if (element && furniture.some(e => e.id === element)) byElement.set(element, [...byElement.get(element) || [], d]); else elsewhere.push(d);
    }
    return { byElement, elsewhere };
  }, [findings, capture, furniture]);
  // Colour code: red once damage is confirmed (by you or the verifier), amber while it still needs a look.
  const tones = useMemo(() => { const out: Record<string, "check" | "damage"> = {}; for (const [id, list] of byElement) { if (list.some(d => d.status === "confirmed")) out[id] = "damage"; else if (list.some(d => d.status === "pending")) out[id] = "check"; } return out; }, [byElement]);
  const [focusFinding, setFocusFinding] = useState<string | null>(null);
  const toItem = (d: Damage): EvidenceItem => ({ id: d.id, label: d.label, detail: [d.description, d.verification ? `Verifier: ${d.verification.verdict.replace("_", " ")} (${Math.round(d.verification.confidence * 100)}%) — ${d.verification.reason}` : ""].filter(Boolean).join(" "), tone: d.status === "confirmed" ? "damage" : "check", image: d.evidence, box: d.box, point: d.point, timestampSeconds: d.timestampSeconds, badge: d.autoApproved && d.confidence != null ? `auto-approved ${Math.round(d.confidence * 100)}%` : d.status === "confirmed" ? "confirmed" : d.confidence != null ? `${Math.round(d.confidence * 100)}% likely` : undefined });
  const focus = useMemo(() => {
    const all = [...byElement.values()].flat().concat(elsewhere);
    if (focusFinding) { const d = all.find(x => x.id === focusFinding); if (d) return { title: d.label, items: [toItem(d)] }; const o = findings.find(f => f.id === focusFinding); if (o) return { title: o.label, items: [{ id: o.id, label: o.label, tone: "object" as const, image: o.evidenceFrameUrl, box: o.boundingBox, timestampSeconds: o.timestampSeconds }] }; }
    if (!selected) return null;
    const damage = (byElement.get(selected) || []).filter(d => d.status !== "rejected").map(toItem);
    const views = findings.filter(f => f.kind === "object" && f.spatialElementId === selected && f.evidenceFrameUrl).slice(0, 4).map(o => ({ id: o.id, label: `${names.get(selected) || o.label} · seen here`, tone: "object" as const, image: o.evidenceFrameUrl, box: o.boundingBox, timestampSeconds: o.timestampSeconds }));
    const items = [...damage, ...views]; return items.length ? { title: names.get(selected) || "Furniture", items } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, focusFinding, byElement, elsewhere, findings, names]);
  const looseFurniture = useMemo(() => manifest ? [] : findings.filter(f => f.kind === "object" && isFurnitureLabel(f.label)), [findings, manifest]);
  const open = [...byElement.values()].flat().concat(elsewhere).filter(d => d.status === "pending").length;
  const confirmed = [...byElement.values()].flat().concat(elsewhere).filter(d => d.status === "confirmed").length;

  async function review(findingId: string, status: "confirmed" | "rejected" | "pending") {
    if (!current) return; setBusy(findingId);
    try { await api.review(current, findingId, status); setFindings(fs => fs.map(f => f.id === findingId ? { ...f, reviewStatus: status, autoApproved: status === "pending" ? false : f.autoApproved } : f)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save your review"); } finally { setBusy(""); }
  }

  async function remove(kind: "scan" | "room") {
    setDeleting(true); setError("");
    try {
      const r = await fetch(kind === "scan" ? `/api/inspections/${current}` : `/api/rooms/${roomId}`, { method: "DELETE" });
      const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || "Could not delete");
      setConfirming("");
      if (kind === "room") { router.push("/"); return; }
      setCurrent(""); setCapture(null); setFindings([]); await loadScans();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete"); } finally { setDeleting(false); }
  }
  const completed = (scans || []).filter(ready);
  const latest = completed[0], earliest = completed[completed.length - 1];
  const next = !completed.length ? { href: `/live?room=${roomId}&type=move-in`, label: "Start the move-in scan" } : { href: `/live?room=${roomId}&type=move-out&baseline=${latest.id}`, label: "Scan again to compare" };
  const compareHref = completed.length >= 2 ? `/rooms/${roomId}/compare?baseline=${earliest.id}&current=${latest.id}` : "";

  const statusText = (d: Damage) => d.status === "rejected" ? "Dismissed" : d.status === "confirmed" ? (d.autoApproved ? `Auto-approved · ${Math.round((d.confidence || 0) * 100)}% confident` : "Confirmed by you") : d.verification ? `Needs your review · verifier ${d.verification.verdict === "damage" ? `${Math.round(d.verification.confidence * 100)}% sure` : d.verification.verdict === "not_damage" ? "doubts it" : "unsure"}` : "Needs your review";
  const renderDamage = (d: Damage) => <li key={d.id} className={`room-finding status-${d.status} ${focusFinding === d.id ? "is-focused" : ""}`}>
    <button type="button" className="room-finding-thumb" onClick={() => setFocusFinding(d.id)} aria-label={`Show ${d.label} in the footage`}>{d.evidence ? <img src={`/api/media?url=${encodeURIComponent(d.evidence)}`} alt="" loading="lazy" /> : <span />}</button>
    <div><b>{d.label}</b>{d.description && <p>{d.description}</p>}<small>{d.source} · {statusText(d)}</small>
      <span className="room-finding-actions">{d.status === "pending" && d.findingId ? <><button disabled={busy === d.findingId} onClick={() => void review(d.findingId!, "confirmed")}><Check size={13} /> Confirm</button><button disabled={busy === d.findingId} onClick={() => void review(d.findingId!, "rejected")}><X size={13} /> Dismiss</button></> : d.findingId && d.status !== "pending" ? <button disabled={busy === d.findingId} onClick={() => void review(d.findingId!, "pending")}>Undo</button> : null}{d.evidence && <button onClick={() => setFocusFinding(d.id)}>Show in footage</button>}</span></div>
  </li>;

  return <main className="live-shell room-detail">
    <header className="live-topbar"><BrandLogo linked compact /><div className="session-breadcrumb"><span>Your spaces</span><i /> <b>{room?.name || "Room"}</b></div></header>
    <div className="workspace-heading room-detail-heading">
      <div><Link href="/" className="back-link"><ArrowLeft size={14} aria-hidden="true" /> Your spaces</Link>
        {room ? <h1>{room.name}</h1> : <span className="skeleton" style={{ display: "block", width: 260, height: 44, margin: "12px 0 10px" }} />}
        <p>{scan ? `${purpose(scan)} scan · ${when(scan.createdAt)}` : scans && !scans.length ? "No scans yet." : " "}</p></div>
      <div className="room-detail-actions">{current && manifest?.assets.some(a => a.kind === "worldmap") && <Link className="button button-outline" href={`/live?room=${roomId}&continue=${current}`}>Continue this scan</Link>}{compareHref && <Link className="button button-outline" href={compareHref}>What changed</Link>}{scans && <Link className="button button-dark" href={next.href}>{next.label} <ArrowUpRight size={16} aria-hidden="true" /></Link>}</div>
    </div>
    {error && <div role="alert" className="notice error-notice">{error}<button onClick={() => setError("")} aria-label="Dismiss message"><X size={16} /></button></div>}
    {scans && scans.length > 1 && <nav className="room-scans" aria-label="Scans of this room">{scans.map(i => <button key={i.id} aria-pressed={i.id === current} onClick={() => setCurrent(i.id)}><b>{purpose(i)}</b><span>{ready(i) ? when(i.createdAt) : i.status === "failed" ? "Failed" : "Analysing…"}</span></button>)}</nav>}

    {scans && !scans.length ? <section className="room-empty"><h2>Begin with the move-in scan.</h2><p>Walk the room with your phone. Dwelld builds it in 3D, outlines the furniture and notes anything worth a closer look.</p><Link className="button button-dark" href={next.href}>{next.label} <ArrowUpRight size={16} /></Link></section> :
    <div className="room-detail-grid">
      <section className="room-detail-stage" aria-label="Room in 3D">
        {!scans || loadingScan ? <div className="room-scene"><div className="room-scene-loading is-live"><DotField /><p>Loading your room…</p></div></div>
          : manifest ? <SpatialViewer manifest={manifest} markers={capture?.markers || []} assetUrl={name => `/api/inspections/${current}/spatial/assets/${encodeURIComponent(name)}`} selectedElementId={selected} hoveredElementId={hovered} onSelectElement={id => { setSelected(id); setFocusFinding(null); }} onHoverElement={setHovered} elementTones={tones} />
          : scan && !ready(scan) ? <div className="room-scene"><div className="room-scene-loading is-live"><DotField /><p>{scan.status === "failed" ? "This scan could not be analysed." : "Analysing this scan. Findings appear here when it's done."}</p></div></div>
          : <div className="room-scene"><div className="room-scene-loading"><p>This scan was a video walkthrough, so there is no 3D room. Its findings are listed alongside.</p><Link className="text-button" href={`/inspections/${current}`}>Open video review ↗</Link></div></div>}
        {manifest && <p className="room-scene-help"><span className="tone-key"><i className="tone-check" />Needs a look</span><span className="tone-key"><i className="tone-damage" />Damage confirmed</span><span>Drag to orbit · click furniture to see its footage</span></p>}
        {scans && <div className="room-danger under-scene">{confirming ? <div className="room-confirm" role="group" aria-label="Confirm delete"><p>{confirming === "scan" ? `Delete the ${scan ? purpose(scan).toLowerCase() : ""} scan? Its 3D room, photos and findings are removed for good.` : `Delete ${room?.name || "this room"} and all ${scans.length} ${scans.length === 1 ? "scan" : "scans"}? This can't be undone.`}</p><span><button className="button button-danger" disabled={deleting} onClick={() => void remove(confirming)}>{deleting ? "Deleting…" : confirming === "scan" ? "Delete scan" : "Delete room"}</button><button className="text-button" disabled={deleting} onClick={() => setConfirming("")}>Keep it</button></span></div>
          : <>{current && <button className="text-button" onClick={() => setConfirming("scan")}>Delete this scan</button>}<button className="text-button" onClick={() => setConfirming("room")}>Delete room</button></>}</div>}
        {focus && <EvidenceViewer key={`${selected}-${focusFinding}`} title={focus.title} items={focus.items} videoUrl={capture?.capture ? undefined : `/api/inspections/${current}/video`} onClose={() => { setFocusFinding(null); setSelected(null); }} />}
      </section>
      <aside className="room-detail-panel" aria-label="What was found">
        <div className="room-summary">
          {loadingScan || !scans ? <><span className="skeleton" style={{ display: "block", height: 18, width: "80%" }} /><span className="skeleton" style={{ display: "block", height: 18, width: "60%", marginTop: 10 }} /></> :
            <p>{manifest ? `${furniture.length} ${furniture.length === 1 ? "piece" : "pieces"} of furniture measured` : `${looseFurniture.length} furniture ${looseFurniture.length === 1 ? "item" : "items"} seen`}. {open ? `${open} ${open === 1 ? "thing needs" : "things need"} your review` : "Nothing waiting for review"}{confirmed ? `, ${confirmed} confirmed` : ""}.</p>}
        </div>
        {manifest && <ol className="room-furniture" onMouseLeave={() => setHovered(null)}>
          {furniture.map(e => { const list = byElement.get(e.id) || [], active = list.filter(d => d.status !== "rejected").length; return <li key={e.id} data-selected={selected === e.id} data-hovered={hovered === e.id}>
            <button type="button" data-tone={tones[e.id] || ""} onMouseEnter={() => setHovered(e.id)} onFocus={() => setHovered(e.id)} onClick={() => { setSelected(s => s === e.id ? null : e.id); setFocusFinding(null); }} aria-expanded={selected === e.id}>
              <span className="room-furniture-name"><b>{names.get(e.id)}</b><small>{e.dimensions.map(n => n.toFixed(2)).join(" × ")} m</small></span>
              <span className={`room-furniture-state ${tones[e.id] ? `has-damage tone-${tones[e.id]}` : ""}`}>{tones[e.id] === "damage" ? `${list.filter(d => d.status === "confirmed").length} confirmed` : active ? `${active} to check` : "No issues noted"}</span>
            </button>
            {selected === e.id && <div className="room-furniture-detail">{list.length ? <ul>{list.map(renderDamage)}</ul> : <p>Nothing was flagged on this piece. That only covers what the scan could see.</p>}</div>}
          </li>; })}
          {!furniture.length && !loadingScan && <li className="room-furniture-empty">No furniture was measured in this scan.</li>}
        </ol>}
        {!manifest && looseFurniture.length > 0 && <ol className="room-furniture">{looseFurniture.map(f => <li key={f.id} data-selected={focusFinding === f.id}><button type="button" onClick={() => setFocusFinding(f.id)}><span className="room-furniture-name"><b>{f.label}</b><small>Seen at {Math.floor(f.timestampSeconds || 0)}s</small></span></button></li>)}</ol>}
        {elsewhere.length > 0 && <section className="room-elsewhere"><h3>Elsewhere in the room</h3><ul>{elsewhere.map(renderDamage)}</ul></section>}
        {current && scan && ready(scan) && <div className="room-detail-links"><Link href={`/inspections/${current}/report`}>Export report ↗</Link><Link href={`/inspections/${current}/spatial`}>Edit markers ↗</Link></div>}
        <p className="inventory-note">AI suggestions need your review. A scan that notes nothing does not prove there is no damage.</p>
      </aside>
    </div>}
  </main>;
}
