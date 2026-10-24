"use client";
import { useEffect, useRef } from "react";

/**
 * Loading surface: a regular dot grid with soft diagonal waves rolling across it.
 * Dots under a wave grow and brighten, then settle back, so it reads as "loading" at a glance.
 */
export default function DotField({ className = "" }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d"); if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, frame = 0, visible = true;
    const gap = 18, period = 2.4; // seconds between waves
    const resize = () => { const r = el.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); w = r.width; h = r.height; el.width = Math.max(1, w * dpr); el.height = Math.max(1, h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const cols = Math.floor(w / gap), rows = Math.floor(h / gap);
      const ox = (w - (cols - 1) * gap) / 2, oy = (h - (rows - 1) * gap) / 2;
      const span = w + h, band = Math.max(70, span * .12), travel = span + band * 2;
      // Position of the wave front along the top-left → bottom-right diagonal.
      const front = ((t / 1000) % period) / period * travel - band;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x = ox + i * gap, y = oy + j * gap;
        const d = (x + y) - front, e = still ? 0 : Math.exp(-(d * d) / (2 * (band / 2.6) ** 2));
        ctx.globalAlpha = .16 + e * .62;
        ctx.fillStyle = e > .55 ? "#2f4237" : "#7f8f78";
        ctx.beginPath(); ctx.arc(x, y, 1.1 + e * 1.9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const loop = (t: number) => { if (visible) draw(t); frame = requestAnimationFrame(loop); };
    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); }); ro.observe(el);
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }); io.observe(el);
    resize();
    if (still) draw(0); else frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={canvas} className={`dot-field ${className}`} aria-hidden="true" />;
}
