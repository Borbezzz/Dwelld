"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Play, X } from "lucide-react";

type Box = { x: number; y: number; width: number; height: number };
export type EvidenceItem = { id: string; label: string; detail?: string; tone: "check" | "damage" | "object"; image?: string; box?: Box | null; point?: { x: number; y: number } | null; timestampSeconds?: number; badge?: string };
const clock = (t?: number) => t == null ? "" : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * The full-resolution source for whatever is selected in 3D: the analysed frame with every
 * finding drawn on it, and for recorded walkthroughs a jump into the video at that moment.
 */
export default function EvidenceViewer({ title, items, videoUrl, onClose }: { title: string; items: EvidenceItem[]; videoUrl?: string; onClose: () => void }) {
  const [index, setIndex] = useState(0), [large, setLarge] = useState(false), [playing, setPlaying] = useState(false), [ratio, setRatio] = useState(4 / 3);
  const video = useRef<HTMLVideoElement>(null), root = useRef<HTMLElement>(null);
  useEffect(() => { root.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }); }, []);
  useEffect(() => { setIndex(0); setPlaying(false); }, [items]);
  const item = items[Math.min(index, items.length - 1)];
  // Everything found on the same frame is drawn together, the selected one on top.
  const sameFrame = useMemo(() => item ? items.filter(i => i.image && i.image === item.image).sort(a => a.id === item.id ? 1 : -1) : [], [items, item]);
  useEffect(() => { const v = video.current; if (!playing || !v || item?.timestampSeconds == null) return; const go = () => { v.currentTime = Math.max(0, item.timestampSeconds! - 1.5); void v.play().catch(() => {}); }; if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true }); }, [playing, item]);
  if (!item) return null;
  return <section ref={root} className={`evidence-viewer ${large ? "is-large" : ""}`} aria-label={`Footage of ${title}`}>
    <header><div><b>{title}</b><span>{item.label}{item.timestampSeconds != null ? ` · ${clock(item.timestampSeconds)}` : ""}</span></div>
      <span className="evidence-tools">{items.length > 1 && <><button aria-label="Previous" onClick={() => { setPlaying(false); setIndex(i => (i - 1 + items.length) % items.length); }}><ChevronLeft size={15} /></button><small>{index + 1}/{items.length}</small><button aria-label="Next" onClick={() => { setPlaying(false); setIndex(i => (i + 1) % items.length); }}><ChevronRight size={15} /></button></>}<button aria-label={large ? "Smaller" : "Larger"} onClick={() => setLarge(l => !l)}>{large ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button><button aria-label="Close footage" onClick={onClose}><X size={15} /></button></span></header>
    <div className="evidence-frame-wrap" style={playing ? { aspectRatio: String(ratio) } : undefined}>
      {playing && videoUrl ? <video ref={video} src={videoUrl} controls playsInline muted onLoadedMetadata={e => setRatio(e.currentTarget.videoWidth / Math.max(1, e.currentTarget.videoHeight))} />
        : item.image ? <div className="evidence-annotated"><img src={`/api/media?url=${encodeURIComponent(item.image)}`} alt={`${item.label} in the analysed frame`} />
          {sameFrame.map(i => i.box ? <span key={i.id} className={`evidence-box tone-${i.tone} ${i.id === item.id ? "is-current" : ""}`} style={{ left: `${i.box.x * 100}%`, top: `${i.box.y * 100}%`, width: `${i.box.width * 100}%`, height: `${i.box.height * 100}%` }}>{i.id === item.id && <em>{i.label}{i.badge ? ` · ${i.badge}` : ""}</em>}</span>
            : i.point ? <span key={i.id} className={`evidence-pin tone-${i.tone}`} style={{ left: `${i.point.x * 100}%`, top: `${i.point.y * 100}%` }} /> : null)}</div>
        : <p className="evidence-missing">No saved frame for this observation.</p>}
    </div>
    <footer>{item.detail && <p>{item.detail}</p>}{videoUrl && item.timestampSeconds != null && <button className="text-button" onClick={() => setPlaying(p => !p)}>{playing ? "Back to the marked frame" : <><Play size={13} /> Play the walkthrough from {clock(Math.max(0, item.timestampSeconds - 1.5))}</>}</button>}</footer>
  </section>;
}
