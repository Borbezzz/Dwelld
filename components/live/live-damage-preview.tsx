'use client';
import { useEffect, useState } from 'react';
import type { LiveFinding } from '@/lib/live/types';

/** Boxes always share the exact source photo; delayed AI coordinates never float over newer video. */
export default function LiveDamagePreview({ sessionId, token, findings }: { sessionId: string; token: string; findings: LiveFinding[] }) {
  const visible = findings.filter(f => f.reviewStatus !== 'rejected' && (f.evidenceFrameRef || f.evidenceFrameUrl));
  const latest = visible.reduce<LiveFinding | undefined>((last, f) => !last || (f.timestampSeconds ?? 0) >= (last.timestampSeconds ?? 0) ? f : last, undefined);
  const ref = latest?.evidenceFrameRef || latest?.evidenceFrameUrl;
  const [photo, setPhoto] = useState<{ ref: string; url: string } | null>(null);
  useEffect(() => {
    if (!ref) return;
    const controller = new AbortController(); let url = '';
    void fetch(`/api/live/${sessionId}/media?ref=${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Evidence unavailable'); return response.blob(); })
      .then(blob => { if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setPhoto({ ref, url }); } }).catch(() => {});
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [sessionId, token, ref]);
  if (!latest || !ref) return null;
  const marks = visible.filter(f => (f.evidenceFrameRef || f.evidenceFrameUrl) === ref);
  return <section className="live-damage-preview" aria-label="Latest damage evidence">
    <header><span className="damage-dot"/><b>Damage spotted</b><small>Source photo · {(latest.timestampSeconds ?? 0).toFixed(1)}s</small></header>
    {photo?.ref === ref ? <div className="live-damage-photo"><img src={photo.url} alt="Photo being checked for damage"/>{marks.map(f => f.boundingBox ? <span key={f.id} className="frozen-damage-box" style={{ left: `${f.boundingBox.x * 100}%`, top: `${f.boundingBox.y * 100}%`, width: `${f.boundingBox.width * 100}%`, height: `${f.boundingBox.height * 100}%` }}><span>{f.label}</span></span> : null)}</div> : <p role="status">Loading the evidence photo…</p>}
    <p>{marks.map(f => f.label).join(' · ')}<small>Suggestions update as analysis finishes. Recording continues.</small></p>
  </section>;
}
