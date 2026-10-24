"use client";
import { useEffect, useRef } from "react";

/**
 * Loading surface: the splat speckle, breathing. Dots swell and brighten as slow interfering
 * waves drift across the grid, so the room reads as taking shape rather than a spinner.
 */
export default function DotField({ className = "" }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d"); if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, frame = 0, visible = true;
    const gap = 17;
    // A fixed scatter per dot keeps the grid organic instead of mechanical.
    const jitter = (i: number, j: number, s: number) => { const v = Math.sin(i * 127.1 + j * 311.7 + s) * 43758.5453; return v - Math.floor(v); };
    const resize = () => { const r = el.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2); w = r.width; h = r.height; el.width = Math.max(1, w * dpr); el.height = Math.max(1, h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const time = t / 1000, cols = Math.ceil(w / gap) + 1, rows = Math.ceil(h / gap) + 1;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x = i * gap + (jitter(i, j, 1) - .5) * 6, y = j * gap + (jitter(i, j, 2) - .5) * 6;
        const nx = x / Math.max(w, 1), ny = y / Math.max(h, 1);
        // Two slow waves crossing at different angles and speeds, plus a breathing swell from the centre.
        const a = Math.sin(nx * 6.2 + ny * 2.1 - time * 1.1), b = Math.sin(nx * -2.4 + ny * 5.3 - time * .7 + 1.3);
        const d = Math.hypot(nx - .5, (ny - .5) * h / Math.max(w, 1)), c = Math.sin(d * 14 - time * 1.6);
        const e = still ? .35 : Math.max(0, (a + b + c * .8) / 2.8 + .32) ** 1.6;
        const tone = jitter(i, j, 3);
        const r = .7 + e * 2.1;
        ctx.globalAlpha = .12 + e * .55;
        ctx.fillStyle = tone > .965 ? "#e39a3b" : tone > .72 ? "#92a48a" : "#364b40";
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
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
