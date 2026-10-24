"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Pause, Play } from "lucide-react";
import type { Finding } from "@/lib/types";
import { portraitEvidenceBox, portraitEvidencePoint } from "@/lib/client/evidence-orientation";
import { findingsForSourceFrame } from "@/lib/inspection-timeline";

const clock = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

/** Sampled inspection photos, played like chapters. Selecting a finding jumps to its timestamp. */
export default function EvidenceTimeline({ frames, findings, selectedId, assetUrl, onSelect, portraitSensorFrames = false }: { portraitSensorFrames?: boolean; frames: { timestamp: number; image: string; width: number; height: number }[]; findings: Finding[]; selectedId?: string; assetUrl: (name: string) => string; onSelect: (id: string) => void }) {
  const ordered = useMemo(() => [...frames].filter(frame => frame.image).sort((a, b) => a.timestamp - b.timestamp), [frames]);
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false), [loadedImage, setLoadedImage] = useState<{source:string;width:number;height:number}|null>(null);
  const selected = findings.find(finding => finding.id === selectedId);
  useEffect(() => {
    if (selected?.timestampSeconds == null || !ordered.length) return;
    let best = 0, gap = Infinity;
    ordered.forEach((frame, i) => { const distance = Math.abs(frame.timestamp - selected.timestampSeconds!); if (distance < gap) { gap = distance; best = i; } });
    setIndex(best); setPlaying(false);
  }, [selected?.id, selected?.timestampSeconds, ordered]);
  useEffect(() => {
    if (!playing || ordered.length < 2) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % ordered.length), 900);
    return () => clearInterval(timer);
  }, [playing, ordered.length]);
  const shownIndex = Math.min(index, Math.max(0, ordered.length - 1));
  const frame = ordered[shownIndex];
  if (!frame) return null;
  const source = assetUrl(frame.image);
  const loaded = loadedImage?.source === source;
  // Saved ARKit photos retain landscape sensor pixels for calibrated depth/projection.
  // Correct only their presentation; images already oriented by EXIF must not rotate twice.
  const rotate = portraitSensorFrames && frame.width > frame.height && !(loaded && loadedImage.width < loadedImage.height);
  const ratio = rotate ? frame.height / frame.width : loaded ? loadedImage.width / loadedImage.height : frame.width / frame.height;
  const visible = loaded ? findingsForSourceFrame(findings.filter(f => f.kind === "damage" && (!portraitSensorFrames || f.source !== "manual")), frame.timestamp) : [];
  return <section className="walkthrough-player" aria-label="Inspection frames">
    <div className="walkthrough-stage" style={{ aspectRatio: ratio, width: `min(100%, calc(var(--stage-max-height, 100000px) * ${ratio}))` }}>
      <img src={source} style={rotate ? {position:"absolute",left:"50%",top:"50%",width:`${frame.width / frame.height * 100}%`,height:`${frame.height / frame.width * 100}%`,maxWidth:"none",transform:"translate(-50%, -50%) rotate(90deg)"} : undefined} onLoad={event => {const image=event.currentTarget;setLoadedImage({source:image.getAttribute("src")||"",width:image.naturalWidth,height:image.naturalHeight})}} alt={`Room at ${clock(frame.timestamp)}`} />
      <div className="walkthrough-marks" aria-label="Findings at this moment">{visible.map(finding => {
        const box = finding.boundingBox ? rotate ? portraitEvidenceBox(finding.boundingBox) : finding.boundingBox : null, point = finding.point ? rotate ? portraitEvidencePoint(finding.point) : finding.point : null; if (!box && !point) return null;
        return <button key={finding.id} type="button" className={`walkthrough-mark ${finding.kind === "damage" ? "is-damage" : "is-object"} ${finding.id === selectedId ? "is-selected" : ""} ${point ? "is-pin" : ""}`} style={box ? { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` } : { left: `${point!.x * 100}%`, top: `${point!.y * 100}%` }} onClick={() => onSelect(finding.id)}><span>{finding.label}</span></button>;
      })}</div>
      <span className="walkthrough-stamp">{clock(frame.timestamp)} · {visible.length} marked observations</span>
    </div>
    <div className="walkthrough-controls"><button type="button" aria-label={playing ? "Pause frames" : "Play frames"} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={17} /> : <Play size={17} />}</button><time>{clock(frame.timestamp)}</time><span>{shownIndex + 1} / {ordered.length}</span><button type="button" onClick={() => { setPlaying(false); setIndex(i => (i + 1) % ordered.length); }}>Next frame <ChevronRight size={15} /></button></div>
    <p className="sampled-playback-note">Sampled source photos · continuous video was not recorded for this scan.</p>
    <div className="walkthrough-timeline"><input aria-label="Frame timeline" type="range" min={0} max={Math.max(0, ordered.length - 1)} step={1} value={shownIndex} onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} /></div>
  </section>;
}
