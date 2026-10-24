"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LiveFinding, NativeLive, NativePose } from "@/lib/live/types";
import { isFurniture, isStructure, furnitureNames } from "@/lib/spatial/furniture";

/** Packed stream from the phone: Int16 x,y,z (mm) + UInt8 r,g,b per point. */
function decodeSplat(base64: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)), count = Math.floor(bytes.length / 9);
  const view = new DataView(bytes.buffer), positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    positions[i * 3] = view.getInt16(o, true) / 1000; positions[i * 3 + 1] = view.getInt16(o + 2, true) / 1000; positions[i * 3 + 2] = view.getInt16(o + 4, true) / 1000;
    colors[i * 3] = bytes[o + 6] / 255; colors[i * 3 + 1] = bytes[o + 7] / 255; colors[i * 3 + 2] = bytes[o + 8] / 255;
  }
  return { positions, colors, count };
}
/** Cast the finding's box centre from the camera that took the preview and stop at the nearest captured surface. */
function locate(f: LiveFinding, pose: NativePose, points: Float32Array | null): THREE.Vector3 | null {
  const box = f.boundingBox; if (!box) return null;
  // The preview is the sensor image rotated 90° clockwise for portrait display.
  const px = box.x + box.width / 2, py = box.y + box.height / 2;
  const u = py * pose.width, v = (1 - px) * pose.height;
  const k = pose.intrinsics, fx = k[0], fy = k[4], cx = k[6], cy = k[7];
  const m = new THREE.Matrix4().fromArray(pose.transform), origin = new THREE.Vector3().setFromMatrixPosition(m);
  const dir = new THREE.Vector3((u - cx) / fx, -(v - cy) / fy, -1).transformDirection(m).normalize();
  if (points) {
    let best = Infinity, hit: THREE.Vector3 | null = null; const p = new THREE.Vector3();
    for (let i = 0; i < points.length; i += 3) {
      p.set(points[i], points[i + 1], points[i + 2]).sub(origin);
      const along = p.dot(dir); if (along < .25 || along > 6) continue;
      const off = p.clone().sub(dir.clone().multiplyScalar(along)).length();
      const score = off + along * .015;
      if (off < .09 && score < best) { best = score; hit = origin.clone().add(dir.clone().multiplyScalar(along)); }
    }
    if (hit) return hit;
  }
  return origin.add(dir.multiplyScalar(1.4));
}

export type StreamChunk = { seq: number; points: string };
type BaseManifest = { elements: { id: string; category: string; dimensions: [number, number, number]; transform: number[] }[]; assets: { name: string; kind: string; registration?: { transform: number[] } }[] };
/** Earlier scan's LiDAR splat (binary little-endian float PLY) as plain coloured points. */
function parsePly(buffer: ArrayBuffer, registration?: number[]) {
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096)));
  const end = head.indexOf("end_header\n"), vertex = /element vertex (\d+)/.exec(head);
  if (end < 0 || !vertex || !head.includes("binary_little_endian")) return null;
  const props = [...head.slice(0, end).matchAll(/property float (\w+)/g)].map(m => m[1]);
  if (/property (?!float)/.test(head.slice(0, end))) return null;
  const at = (n: string) => props.indexOf(n), stride = props.length * 4, start = new TextEncoder().encode(head.slice(0, end + 11)).length;
  const count = Math.min(Number(vertex[1]), Math.floor((buffer.byteLength - start) / stride));
  const [x, y, z, r, g, b] = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2"].map(at);
  if ([x, y, z].some(i => i < 0)) return null;
  const view = new DataView(buffer, start), positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const m = registration ? new THREE.Matrix4().fromArray(registration) : null, p = new THREE.Vector3();
  const colour = (i: number, o: number) => i < 0 ? .6 : Math.min(1, Math.max(0, .5 + .2820948 * view.getFloat32(o + i * 4, true)));
  for (let i = 0; i < count; i++) {
    const o = i * stride; p.set(view.getFloat32(o + x * 4, true), view.getFloat32(o + y * 4, true), view.getFloat32(o + z * 4, true)); if (m) p.applyMatrix4(m);
    positions.set([p.x, p.y, p.z], i * 3);
    // Muted so the part being scanned now stands out against the earlier room.
    colors.set([colour(r, o) * .55 + .1, colour(g, o) * .55 + .1, colour(b, o) * .55 + .1], i * 3);
  }
  return { positions, colors, count };
}
const CAPACITY = 250_000;
export default function LiveRoomView({ live, stream = [], findings, selected, onSelect, baseInspectionId }: { live?: NativeLive; stream?: StreamChunk[]; findings: LiveFinding[]; selected?: string; onSelect?: (id: string) => void; baseInspectionId?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<{ base: THREE.Group; points: THREE.Points; fresh: THREE.Points; freshAt: number; boxes: THREE.Group; markers: THREE.Group; fit: (box: THREE.Box3) => void; render: () => void; positions: Float32Array | null } | null>(null);
  const streamed = useRef({ seq: 0, count: 0, positions: new Float32Array(CAPACITY * 3), colors: new Float32Array(CAPACITY * 3), box: new THREE.Box3() });
  const seen = useRef(new Map<string, number>());
  const [count, setCount] = useState(0), [baseCount, setBaseCount] = useState(0);
  const baseBox = useRef(new THREE.Box3());
  const select = useRef(onSelect); select.current = onSelect;

  useEffect(() => {
    const element = root.current; if (!element) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#161b17");
    const camera = new THREE.PerspectiveCamera(50, 1, .01, 200); camera.position.set(3, 2.6, 3.4);
    let renderer: THREE.WebGLRenderer; try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches; controls.autoRotateSpeed = .5;
    const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: .03, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: .95 }));
    // The newest points flash brighter and larger, then settle into the room: you can watch it being scanned.
    const fresh = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: .05, color: 0xf0c27a, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false }));
    const boxes = new THREE.Group(), markers = new THREE.Group(), base = new THREE.Group(); scene.add(base, points, fresh, boxes, markers);
    const grid = new THREE.GridHelper(8, 16, 0x3a443a, 0x262d27); grid.position.y = -1.4; scene.add(grid);
    const goal = { target: new THREE.Vector3(), distance: 4.5 };
    const fit = (box: THREE.Box3) => { if (box.isEmpty()) return; goal.target.copy(box.getCenter(new THREE.Vector3())); goal.distance = Math.max(2.4, box.getSize(new THREE.Vector3()).length() * .9); grid.position.y = box.min.y - .01; };
    const resize = new ResizeObserver(() => { camera.aspect = element.clientWidth / Math.max(1, element.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(element.clientWidth, element.clientHeight); }); resize.observe(element);
    renderer.setAnimationLoop(() => {
      const t = performance.now() / 1000;
      controls.target.lerp(goal.target, .04);
      const offset = camera.position.clone().sub(controls.target), len = offset.length();
      if (Math.abs(len - goal.distance) > .02) camera.position.copy(controls.target).add(offset.multiplyScalar(1 + (goal.distance / len - 1) * .04));
      const age = t - (world.current?.freshAt ?? 0); (fresh.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 1.2);
      markers.children.forEach(m => { const born = m.userData.born as number, age = t - born; const pulse = age < 1.2 ? 1 + Math.sin(age * 10) * .5 * (1.2 - age) : 1; m.scale.setScalar((m.userData.active ? 1.5 : 1) * pulse); });
      controls.update(); renderer.render(scene, camera);
    });
    const ray = new THREE.Raycaster(); ray.params.Points = { threshold: .05 };
    const click = (e: MouseEvent) => { const r = renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera); const hit = ray.intersectObjects(markers.children, false)[0]; if (hit) select.current?.(hit.object.userData.id); };
    renderer.domElement.addEventListener("click", click);
    world.current = { base, points, fresh, freshAt: 0, boxes, markers, fit, render: () => {}, positions: null };
    return () => { renderer.domElement.removeEventListener("click", click); resize.disconnect(); renderer.setAnimationLoop(null); controls.dispose(); scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.LineSegments) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); renderer.dispose(); element.replaceChildren(); world.current = null; };
  }, []);

  // Incremental stream: append only the points that arrived since the last chunk.
  useEffect(() => {
    const w = world.current, acc = streamed.current; if (!w) return;
    const incoming = stream.filter(c => c.seq > acc.seq); if (!incoming.length) return;
    if (acc.seq === 0) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(acc.positions, 3)); g.setAttribute("color", new THREE.BufferAttribute(acc.colors, 3)); g.setDrawRange(0, 0); w.points.geometry.dispose(); w.points.geometry = g; }
    const start = acc.count;
    for (const chunk of incoming) {
      const { positions, colors, count } = decodeSplat(chunk.points), room = Math.min(count, CAPACITY - acc.count);
      acc.positions.set(positions.subarray(0, room * 3), acc.count * 3); acc.colors.set(colors.subarray(0, room * 3), acc.count * 3);
      for (let i = 0; i < room; i++) acc.box.expandByPoint(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
      acc.count += room; acc.seq = chunk.seq;
    }
    const g = w.points.geometry; (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true; (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true; g.setDrawRange(0, acc.count); g.computeBoundingSphere();
    const latest = new THREE.BufferGeometry(); latest.setAttribute("position", new THREE.BufferAttribute(acc.positions.slice(start * 3, acc.count * 3), 3)); w.fresh.geometry.dispose(); w.fresh.geometry = latest; w.freshAt = performance.now() / 1000;
    w.positions = acc.positions.subarray(0, acc.count * 3); setCount(acc.count); w.fit(acc.box.clone().union(baseBox.current));
  }, [stream]);

  // Continuing a scan: the earlier room sits underneath, and the new part fills in on top of it.
  useEffect(() => {
    if (!baseInspectionId) return;
    const controller = new AbortController();
    (async () => {
      const r = await fetch(`/api/inspections/${baseInspectionId}/spatial`, { signal: controller.signal }); if (!r.ok) return;
      const manifest = (await r.json()).capture?.manifest as BaseManifest | undefined, w = world.current; if (!manifest || !w) return;
      for (const e of manifest.elements) {
        if (!isFurniture(e)) continue;
        const geometry = new THREE.BoxGeometry(...e.dimensions.map(n => Math.max(n, .01)) as [number, number, number]);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x9aa394, transparent: true, opacity: .45 }));
        edges.applyMatrix4(new THREE.Matrix4().fromArray(e.transform)); w.base.add(edges); geometry.dispose();
        baseBox.current.expandByPoint(new THREE.Vector3(e.transform[12], e.transform[13], e.transform[14]));
      }
      const splat = manifest.assets.find(a => a.kind === "splat");
      if (splat) {
        const res = await fetch(`/api/inspections/${baseInspectionId}/spatial/assets/${encodeURIComponent(splat.name)}`, { signal: controller.signal });
        const parsed = res.ok ? parsePly(await res.arrayBuffer(), splat.registration?.transform) : null;
        if (parsed && world.current === w) {
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(parsed.positions, 3)); geometry.setAttribute("color", new THREE.BufferAttribute(parsed.colors, 3));
          geometry.computeBoundingBox(); if (geometry.boundingBox) baseBox.current.union(geometry.boundingBox);
          w.base.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: .025, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: .55, depthWrite: false })));
          setBaseCount(parsed.count);
        }
      }
      if (world.current === w) w.fit(streamed.current.box.clone().union(baseBox.current));
    })().catch(() => {});
    return () => controller.abort();
  }, [baseInspectionId]);

  // Older phone builds send a whole-room sample instead of a stream.
  useEffect(() => {
    const w = world.current; if (!w || !live?.splat || streamed.current.seq > 0) return;
    const { positions, colors, count } = decodeSplat(live.splat);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    w.points.geometry.dispose(); w.points.geometry = geometry; w.positions = positions; setCount(count);
    geometry.computeBoundingBox(); if (geometry.boundingBox) w.fit(geometry.boundingBox);
  }, [live?.splat]);

  // RoomPlan furniture boxes and faint walls, merged into the same space.
  useEffect(() => {
    const w = world.current; if (!w) return;
    w.boxes.children.slice().forEach(o => { w.boxes.remove(o); if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    for (const e of live?.elements || []) {
      const geometry = new THREE.BoxGeometry(...e.dimensions.map(n => Math.max(n, .01)) as [number, number, number]), matrix = new THREE.Matrix4().fromArray(e.transform);
      if (isFurniture(e)) { const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xf0c27a, transparent: true, opacity: .9 })); edges.applyMatrix4(matrix); w.boxes.add(edges); }
      else if (isStructure(e)) { const plane = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x9fb39a, transparent: true, opacity: .07, side: THREE.DoubleSide, depthWrite: false })); plane.applyMatrix4(matrix); w.boxes.add(plane); }
      geometry.dispose();
    }
  }, [live?.elements]);

  // Findings appear as pulsing pins where the camera saw them.
  useEffect(() => {
    const w = world.current; if (!w) return;
    const now = performance.now() / 1000;
    w.markers.children.slice().forEach(o => { w.markers.remove(o); if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    for (const f of findings) {
      if (f.reviewStatus === "rejected" || (!f.pose && !f.worldPosition)) continue;
      // Phone marks carry their measured LiDAR point; AI findings are cast from the camera pose.
      const at = f.worldPosition ? new THREE.Vector3(...f.worldPosition) : locate(f, f.pose!, w.positions); if (!at) continue;
      if (!seen.current.has(f.id)) seen.current.set(f.id, now);
      const pin = new THREE.Mesh(new THREE.SphereGeometry(.055, 16, 16), new THREE.MeshBasicMaterial({ color: f.reviewStatus === "confirmed" ? 0x4f9a5f : 0xe0583f, depthTest: false }));
      pin.position.copy(at); pin.renderOrder = 5; pin.userData = { id: f.id, born: seen.current.get(f.id)!, active: f.id === selected };
      w.markers.add(pin);
    }
    // Re-place pins as the room fills in, so camera-cast findings land on real surfaces.
  }, [findings, selected, live?.splat, Math.floor(count / 5000)]);

  const furniture = (live?.elements || []).filter(isFurniture), names = furnitureNames(furniture);
  return <div className="live-room-view">
    <div ref={root} className="live-room-canvas" aria-label="Your room building in 3D as the phone scans" />
    <div className="live-room-legend">{baseCount > 0 && <span><i className="dot-base" />Earlier scan</span>}<span><i className="dot-splat" />{count ? `${count.toLocaleString()} ${baseCount ? "new " : ""}points` : baseCount ? "Find a part you already scanned" : "Waiting for depth"}</span><span><i className="dot-furniture" />{furniture.length} furniture</span><span><i className="dot-damage" />{findings.filter(f => (f.pose || f.worldPosition) && f.reviewStatus !== "rejected").length} pinned</span></div>
    {!count && !baseCount && <div className="live-room-empty"><p>Your room builds here as you scan.</p></div>}
    {furniture.length > 0 && <ul className="live-room-tags">{furniture.slice(0, 6).map(e => <li key={e.id}>{names.get(e.id)}</li>)}</ul>}
  </div>;
}
