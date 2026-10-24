"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, RotateCcw, X } from "lucide-react";
import type { Inspection, Room } from "@/lib/types";
import type { ComparisonRecord, ComparisonEvidence, ChangeType } from "@/lib/comparison";
import "@/app/comparison.css";
import ComparisonSpatial from "./comparison-spatial";
import {ProcessProgress} from "./live/scan-workflow";
import InspectionProgress from "./inspection-progress";
import {inspectionLabel,isInspectionProcessing} from "@/lib/processing-workflow";
import BrandLogo from "./brand-logo";

async function request<T>(url: string, init?: RequestInit): Promise<T> { const r = await fetch(url, init); const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || "Comparison request failed"); return body; }
const CATEGORY: Record<ChangeType, { label: string; tone: string }> = {
  potentially_new: { label: "Possibly new", tone: "new" }, missing_or_changed: { label: "Missing or changed", tone: "new" },
  pre_existing: { label: "Already there at move-in", tone: "known" }, unchanged: { label: "Unchanged", tone: "calm" },
  no_longer_visible: { label: "No longer visible", tone: "calm" }, uncertain: { label: "Can't tell from the scans", tone: "unsure" },
};
const ORDER: ChangeType[] = ["potentially_new", "missing_or_changed", "uncertain", "pre_existing", "no_longer_visible", "unchanged"];
const ready = (i?: Inspection) => !!i && (i.status === "completed" || i.status === "partial");
const label=inspectionLabel;
type ComparisonJob={id:string;status:string;baselineInspectionId:string;currentInspectionId:string;startedAt?:string;progress?:{phase:string;processed?:number;total?:number};error?:string};

function Evidence({ finding, side }: { finding?: ComparisonEvidence; side: string }) {
  return <figure className="compare-evidence"><figcaption>{side}</figcaption>{finding ? <>{finding.evidenceFrameUrl ? <div className="compare-image"><img src={`/api/media?url=${encodeURIComponent(finding.evidenceFrameUrl)}`} alt={`${side}: ${finding.label}`} loading="lazy" />{finding.boundingBox && <span className="compare-box" style={{ left: `${finding.boundingBox.x * 100}%`, top: `${finding.boundingBox.y * 100}%`, width: `${finding.boundingBox.width * 100}%`, height: `${finding.boundingBox.height * 100}%` }} />}{finding.point && <span className="compare-point" style={{ left: `${finding.point.x * 100}%`, top: `${finding.point.y * 100}%` }} />}</div> : <div className="compare-image compare-image-empty">No saved image</div>}<p><b>{finding.label}</b>{finding.description ? ` · ${finding.description}` : ""}</p></> : <div className="compare-image compare-image-empty">Not seen in this scan</div>}</figure>;
}

export default function ComparisonWorkspace({ roomId, baselineId = "", currentId = "" }: { roomId: string; baselineId?: string; currentId?: string }) {
  const [room, setRoom] = useState<Room | null>(null), [inspections, setInspections] = useState<Inspection[] | null>(null);
  const [records, setRecords] = useState<ComparisonRecord[]>([]), [record, setRecord] = useState<ComparisonRecord | null>(null);
  const [baseline, setBaseline] = useState(baselineId), [current, setCurrent] = useState(currentId);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [spatial, setSpatial] = useState<{ baseline: string | null; current: string | null } | null>(null);
  const initialized=useRef(false),requestVersion=useRef(0),selectedPair=useRef({baseline,current});selectedPair.current={baseline,current};
  const pollingNeeded=useRef(true);
  const [job,setJob]=useState<ComparisonJob|null>(null),[loading,setLoading]=useState(true);
  const applyRecord=useCallback((comparison:ComparisonRecord)=>{setRecord(comparison);setBaseline(String(comparison.baselineInspectionId));setCurrent(String(comparison.currentInspectionId));setSpatial(null);},[]);

  pollingNeeded.current=loading||!!job||!!busy||!!inspections?.some(isInspectionProcessing);

  const load = useCallback(async () => {
    const [r, a, b] = await Promise.all([request<{ room: Room }>(`/api/rooms/${roomId}`), request<{ inspections: Inspection[] }>(`/api/inspections?roomId=${roomId}`), request<{ comparisons: ComparisonRecord[];activeComparison:ComparisonJob|null;lastJob?:ComparisonJob }>(`/api/comparisons?roomId=${roomId}`)]);
    setRoom(r.room); setInspections(a.inspections); setRecords(b.comparisons);setJob(b.activeComparison);
    if(b.lastJob?.status==='failed'&&b.lastJob.baselineInspectionId===selectedPair.current.baseline&&b.lastJob.currentInspectionId===selectedPair.current.current)setError(b.lastJob.error||'Comparison stopped. Retry the saved scans.');
    return { inspections: a.inspections, comparisons: b.comparisons };
  }, [roomId]);

  const openComparison = useCallback(async (id: string,explicit=false) => { setError(""); if(explicit)requestVersion.current++;const version=requestVersion.current; try { const data = await request<{ comparison: ComparisonRecord }>(`/api/comparisons/${id}`); if(version===requestVersion.current)applyRecord(data.comparison); } catch (e) { setError(e instanceof Error ? e.message : "Could not open comparison"); } }, [applyRecord]);

  const compare = useCallback(async (b: string, c: string) => {
    const version=++requestVersion.current;
    setBusy("Comparing selected scans");setError("");
    setJob({id:'starting',status:'processing',baselineInspectionId:b,currentInspectionId:c,progress:{phase:'Preparing saved evidence'}});
    try {
      const {comparison}=await request<{comparison:ComparisonRecord}>("/api/comparisons",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({baselineInspectionId:b,currentInspectionId:c,roomId})});
      setRecords(r=>[comparison,...r.filter(x=>x.id!==comparison.id)]);
      if(version===requestVersion.current&&selectedPair.current.baseline===b&&selectedPair.current.current===c)applyRecord(comparison);
    }catch(e){if(version===requestVersion.current)setError(e instanceof Error?e.message:"Comparison failed");}
    finally{setBusy("");setJob(null);void load().catch(()=>{});}
  },[roomId,load,applyRecord]);

  // Loading a page never starts an AI comparison. Keep selections stable as jobs update.
  useEffect(()=>{let active=true,running=false;const tick=async()=>{
    if(running)return;running=true;
    try{const data=await load();if(!active)return;
      if(!initialized.current){initialized.current=true;const done=data.inspections.filter(ready).sort((a,b)=>+new Date(a.createdAt)-+new Date(b.createdAt));
        setBaseline(baselineId||done[0]?.id||'');setCurrent(currentId||(done.length>1?done.at(-1)!.id:''));
      }
    }catch(e){if(active)setError(e instanceof Error?e.message:'Could not load this room');}
    finally{running=false;if(active)setLoading(false);}
  };void tick();const timer=setInterval(()=>{if(pollingNeeded.current)void tick();},4000);return()=>{active=false;clearInterval(timer);};},[load,baselineId,currentId]);

  useEffect(()=>{const existing=records.find(r=>String(r.baselineInspectionId)===baseline&&String(r.currentInspectionId)===current);if(existing&&record?.id!==existing.id)void openComparison(existing.id);},[records,baseline,current,record?.id,openComparison]);
  const changeSelection=(side:'baseline'|'current',value:string)=>{requestVersion.current++;setError('');setRecord(null);setSpatial(null);if(side==='baseline'){setBaseline(value);const earlier=inspections?.find(i=>i.id===value),later=inspections?.find(i=>i.id===current);if(earlier&&later&&+new Date(earlier.createdAt)>=+new Date(later.createdAt))setCurrent('');}else setCurrent(value);};

  async function review(changeId: string, status: string) {
    if (!record) return; setError("");
    try { const { comparison } = await request<{ comparison: ComparisonRecord }>(`/api/comparisons/${record.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeId, status, note: "" }) }); setRecord(comparison); setRecords(rs => rs.map(r => r.id === comparison.id ? comparison : r)); }
    catch (e) { setError(e instanceof Error ? e.message : "Review failed"); }
  }

  const done = (inspections || []).filter(ready);
  const earlier=inspections?.find(i=>i.id===baseline),later=inspections?.find(i=>i.id===current);
  const validPair=!!earlier&&!!later&&earlier.id!==later.id&&+new Date(earlier.createdAt)<+new Date(later.createdAt);
  const pairReady=validPair&&ready(earlier)&&ready(later)&&!isInspectionProcessing(earlier)&&!isInspectionProcessing(later);
  const scanName=(id:string)=>{const scan=inspections?.find(i=>i.id===id);return scan?label(scan):`Scan ${id.slice(-6)}`;};
  const counts = record ? ORDER.map(k => [k, record.changes.filter(c => c.category === k).length] as const).filter(([, n]) => n) : [];
  const changes = record ? [...record.changes].sort((x, y) => ORDER.indexOf(x.category) - ORDER.indexOf(y.category)) : [];

  return <main className="live-shell comparison-page">
    <header className="live-topbar"><BrandLogo linked compact /><div className="session-breadcrumb"><span>{room?.name || "Room"}</span><i /> <b>What changed</b></div></header>
    <div className="workspace-heading"><div><Link href={`/rooms/${roomId}`} className="back-link"><ArrowLeft size={14} aria-hidden="true" /> {room?.name || "Back to the room"}</Link><h1>What changed?</h1><p>Your move-in and move-out scans, side by side. Confirm what looks right and dismiss what doesn&apos;t.</p></div></div>
    <div className="compare-selection">
      <label>Earlier scan<select className="field" value={baseline} onChange={e=>changeSelection('baseline',e.target.value)}><option value="">Choose a scan</option>{(inspections||[]).map(i => <option value={i.id} key={i.id}>{label(i)}{isInspectionProcessing(i)?" · Processing":i.status==='failed'?" · Failed":""}</option>)}</select></label>
      <label>Later scan<select className="field" value={current} onChange={e=>changeSelection('current',e.target.value)}><option value="">Choose a scan</option>{(inspections||[]).filter(i => i.id !== baseline&&(!earlier||+new Date(i.createdAt)>+new Date(earlier.createdAt))).map(i => <option value={i.id} key={i.id}>{label(i)}{isInspectionProcessing(i)?" · Processing":i.status==='failed'?" · Failed":""}</option>)}</select></label>
      <button className="button button-dark" disabled={!!busy||!!job||!pairReady} onClick={() => void compare(baseline, current)}>{record && record.baselineInspectionId === baseline && record.currentInspectionId === current ? "Compare again" : "Compare"}</button>
    </div>
    {loading&&<p role="status">Loading scans and background tasks…</p>}
    {earlier&&<p className="compare-pair-label">{label(earlier)} → {later?label(later):'Choose a later scan'}</p>}
    {[earlier,later].filter((i):i is Inspection=>!!i&&isInspectionProcessing(i)).map(i=><InspectionProgress key={i.id} inspection={i}/>)}
    {inspections && done.length < 2 && !busy && <div className="compare-empty"><p>Compare needs two finished scans of this room.</p><Link className="button button-dark" href={done[0] ? `/live?room=${roomId}&type=move-out&baseline=${done[0].id}` : `/live?room=${roomId}&type=move-in`}>{done[0] ? "Choose a new scan" : "Start the move-in scan"}</Link></div>}
    {(job||busy)&&<ProcessProgress title="Comparison progress" context={job?`${scanName(job.baselineInspectionId)} → ${scanName(job.currentInspectionId)}`:'Selected scans'} rows={[{key:'compare',label:job?.progress?.phase||busy,amount:job?.progress?.total?`${job.progress.processed||0}/${job.progress.total} images`:'Argon',status:'running',details:[{label:'Earlier scan',meta:job?scanName(job.baselineInspectionId):baseline},{label:'Later scan',meta:job?scanName(job.currentInspectionId):current},{label:'Result',meta:'Saved changes will appear when the comparison finishes'}]}]}/> }
    {error && <div role="alert" className="notice error-notice">{error}<button onClick={() => setError("")} aria-label="Dismiss message"><X size={16} /></button></div>}
    {records.length > 0 && <details className="compare-history"><summary>Saved comparisons · {records.length}</summary><nav className="room-scans" aria-label="Saved comparisons">{records.slice(0, 8).map(r => <button key={r.id} aria-pressed={record?.id === r.id} onClick={() => void openComparison(r.id,true)}><b>{scanName(String(r.baselineInspectionId))} → {scanName(String(r.currentInspectionId))}</b><span>{new Date(r.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></button>)}</nav></details>}
    {record && <>
      <section className="compare-summary" aria-label="Summary">{counts.length ? counts.map(([k, n]) => <span key={k} className={`compare-tag tone-${CATEGORY[k].tone}`}><b>{n}</b> {CATEGORY[k].label}</span>) : <span>No differences were proposed. That is not proof the room is unchanged.</span>}</section>
      {changes.map(change => <article className={`compare-change tone-${CATEGORY[change.category].tone}`} key={change.id}>
        <header><span className={`compare-tag tone-${CATEGORY[change.category].tone}`}>{CATEGORY[change.category].label}</span><span className="compare-status">{change.reviewStatus === "confirmed" ? "Confirmed" : change.reviewStatus === "rejected" ? "Dismissed" : change.comparableView ? "Needs your review" : "Views not directly comparable"}</span></header>
        <p className="compare-explanation">{change.explanation}</p>
        <div className="compare-pair"><Evidence side="Earlier scan" finding={record.baseline.find(f => f.id === change.baselineFindingId)} /><Evidence side="Later scan" finding={record.current.find(f => f.id === change.currentFindingId)} /></div>
        <div className="compare-actions">{change.reviewStatus === "pending" ? <><button className="text-button" onClick={() => void review(change.id, "confirmed")}><Check size={14} /> Confirm</button><button className="text-button" onClick={() => void review(change.id, "rejected")}><X size={14} /> Dismiss</button></> : <button className="text-button" onClick={() => void review(change.id, "pending")}><RotateCcw size={13} /> Undo</button>}<button className="text-button" onClick={() => setSpatial({ baseline: change.baselineFindingId, current: change.currentFindingId })}>Show in 3D</button></div>
      </article>)}
      {record.warnings.length > 0 && <details className="compare-notes"><summary>About this comparison</summary>{record.warnings.map(w => <p key={w}>{w}</p>)}</details>}
      {spatial&&<><button className="text-button" onClick={()=>setSpatial(null)}>Hide 3D comparison</button><ComparisonSpatial baselineInspectionId={record.baselineInspectionId} currentInspectionId={record.currentInspectionId} baselineFindingId={spatial?.baseline} currentFindingId={spatial?.current} /></>}
    </>}
  </main>;
}
