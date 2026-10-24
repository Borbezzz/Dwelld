"use client";
import { useEffect, useRef } from "react";

/**
 * Loading surface: a cube of dots, like a room's point cloud still being measured.
 * It turns slowly while a soft wave rolls diagonally through it, swelling and darkening the
 * dots it passes. Drawn on a 2D canvas (no WebGL) so it appears instantly.
 */
export default function DotField({ className = "" }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d"); if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, frame = 0, visible = true;
    const N = 8, points: [number, number, number][] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) points.push([i / (N - 1) - .5, j / (N - 1) - .5, k / (N - 1) - .5]);
    const projected = points.map(() => ({ x: 0, y: 0, z: 0, e: 0 }));
    const resize = () => { const r = el.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); w = r.width; h = r.height; el.width = Math.max(1, w * dpr); el.height = Math.max(1, h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const s = still ? 0 : t / 1000;
      const yaw = .6 + s * .16, pitch = -.42 + Math.sin(s * .12) * .08; // about one turn every 40 s
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const size = Math.min(w, h) * .36, cam = 3.6;
      // Wave position along the cube's main diagonal, one pass every 4.5 s.
      const front = ((s / 4.5) % 1) * 3.2 - 1.6;
      points.forEach(([x, y, z], i) => {
        const x1 = x * cy - z * sy, z1 = x * sy + z * cy, y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const p = cam / (cam - z2);
        const d = (x + y + z) - front, e = still ? 0 : Math.exp(-(d * d) / .09);
        projected[i] = { x: w / 2 + x1 * size * p, y: h * .46 + y1 * size * p, z: z2, e };
      });
      projected.sort((a, b) => a.z - b.z);
      for (const q of projected) {
        const depth = (q.z + .9) / 1.8; // 0 at the back, 1 at the front
        ctx.globalAlpha = .1 + depth * .28 + q.e * .55;
        ctx.fillStyle = q.e > .5 ? "#2f4237" : "#7f8f78";
        ctx.beginPath(); ctx.arc(q.x, q.y, (.8 + depth * 1.1) * (1 + q.e * 1.1), 0, Math.PI * 2); ctx.fill();
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
