"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Pause, Play } from "lucide-react";
import type { Finding } from "@/lib/types";
import { findingsAtTime } from "@/lib/inspection-timeline";

const clock = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

/** Sampled inspection photos, played like chapters. Selecting a finding jumps to its timestamp. */
export default function EvidenceTimeline({ frames, findings, selectedId, assetUrl, onSelect }: { frames: { timestamp: number; image: string }[]; findings: Finding[]; selectedId?: string; assetUrl: (name: string) => string; onSelect: (id: string) => void }) {
  const ordered = useMemo(() => [...frames].filter(frame => frame.image).sort((a, b) => a.timestamp - b.timestamp), [frames]);
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false);
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
  const frame = ordered[Math.min(index, Math.max(0, ordered.length - 1))];
  if (!frame) return null;
  const visible = findingsAtTime(findings, frame.timestamp, 0.75);
  return <section className="walkthrough-player" aria-label="Inspection frames">
    <div className="walkthrough-stage" style={{ aspectRatio: "16 / 9" }}>
      <img src={assetUrl(frame.image)} alt={`Room at ${clock(frame.timestamp)}`} />
      <div className="walkthrough-marks" aria-label="Findings at this moment">{visible.map(finding => {
        const box = finding.boundingBox, point = finding.point; if (!box && !point) return null;
        return <button key={finding.id} type="button" className={`walkthrough-mark ${finding.kind === "damage" ? "is-damage" : "is-object"} ${finding.id === selectedId ? "is-selected" : ""} ${point ? "is-pin" : ""}`} style={box ? { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` } : { left: `${point!.x * 100}%`, top: `${point!.y * 100}%` }} onClick={() => onSelect(finding.id)}><span>{finding.label}</span></button>;
      })}</div>
      <span className="walkthrough-stamp">{clock(frame.timestamp)} · {visible.length} marked observations</span>
    </div>
    <div className="walkthrough-controls"><button type="button" aria-label={playing ? "Pause frames" : "Play frames"} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={17} /> : <Play size={17} />}</button><time>{clock(frame.timestamp)}</time><span>{index + 1} / {ordered.length}</span><button type="button" onClick={() => { setPlaying(false); setIndex(i => (i + 1) % ordered.length); }}>Next frame <ChevronRight size={15} /></button></div>
    <div className="walkthrough-timeline"><input aria-label="Frame timeline" type="range" min={0} max={Math.max(0, ordered.length - 1)} step={1} value={index} onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} /></div>
  </section>;
}
