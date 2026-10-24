"use client";
import { useEffect, useRef, useState } from "react";
import DotField from "./dot-field";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ObjectCloud } from "@/lib/spatial/object-reconstruction";
import type { SpatialManifest, SpatialMarker, Vec3 } from "@/lib/spatial/types";
import { furnitureNames, isFurniture, isStructure } from "@/lib/spatial/furniture";

type Props = {
  manifest: SpatialManifest; markers: SpatialMarker[]; assetUrl: (name: string) => string;
  onPick?: (point: Vec3, elementId: string | null) => void;
  selectedElementId?: string | null; hoveredElementId?: string | null;
  onSelectElement?: (id: string | null) => void; onHoverElement?: (id: string | null) => void;
  damagedElementIds?: string[]; elementTones?: Record<string, "check" | "damage">; compact?: boolean; className?: string;
  reconstruction?: (ObjectCloud & { caption: string }) | null; reconstructing?: boolean;
};
// Selection is blue so it never reads as a status. Amber = needs a look, red = damage confirmed.
const INK = 0x2f3a2c, ACTIVE = 0x3f8fd2, CHECK = 0xe39a3b, DAMAGE = 0xc4573f;

/**
 * One 3D space: the Gaussian splat (when present) with the measured furniture boxes inside it.
 * Hover a box to outline it, click it to select it. Walls and floors are context, never listed.
 */
export default function SpatialViewer({ manifest, markers, assetUrl, onPick, selectedElementId, hoveredElementId, onSelectElement, onHoverElement, damagedElementIds = [], elementTones = {}, compact = false, className = "", reconstruction = null, reconstructing = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const splat = manifest.assets.find(a => a.kind === "splat");
  const aligned = !!splat && (!!splat.registration || splat.reconstructionMethod === "lidar-initialized");
  const [mode, setMode] = useState<"room" | "geometry">(splat ? "room" : "geometry");
  const [error, setError] = useState(""), [loading, setLoading] = useState(!!splat);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const callbacks = useRef({ onPick, onSelectElement, onHoverElement }); callbacks.current = { onPick, onSelectElement, onHoverElement };
  const tones = { ...Object.fromEntries(damagedElementIds.map(id => [id, "check" as const])), ...elementTones };
  const state = useRef({ selected: selectedElementId ?? null, hovered: hoveredElementId ?? null, localHover: null as string | null, tones, showCloud: !!reconstruction });
  state.current.selected = selectedElementId ?? null; state.current.hovered = hoveredElementId ?? null; state.current.tones = tones; state.current.showCloud = !!reconstruction;
  const scene = useRef<{ highlight: () => void; focus: (id: string | null) => void; markers: (list: SpatialMarker[]) => void; cloud: (cloud: ObjectCloud | null) => void } | null>(null);
  const markersRef = useRef(markers); markersRef.current = markers;
  const cloudRef = useRef<ObjectCloud | null>(reconstruction); cloudRef.current = reconstruction;
  useEffect(() => { scene.current?.markers(markers); }, [markers]);
  useEffect(() => { scene.current?.cloud(reconstruction ?? null); scene.current?.highlight(); }, [reconstruction]);
  const splatUrl = splat ? assetUrl(splat.name) : "";
  const damagedKey = JSON.stringify(tones);

  useEffect(() => { scene.current?.highlight(); }, [selectedElementId, hoveredElementId, damagedKey]);
  useEffect(() => { scene.current?.focus(selectedElementId ?? null); }, [selectedElementId]);

  useEffect(() => {
    const element = root.current; if (!element) return;
    setError(""); setTip(null);
    const useSplat = mode === "room" && !!splatUrl;
    setLoading(useSplat);
    const showBoxes = !useSplat || aligned;
    const names = furnitureNames(manifest.elements.filter(isFurniture));
    // ---- Overlay: furniture boxes, markers and (geometry mode only) faint room structure.
    const group = new THREE.Group();
    const picks: THREE.Mesh[] = [], structure: THREE.Mesh[] = [];
    const items = new Map<string, { edges: THREE.LineSegments; fill: THREE.Mesh; center: THREE.Vector3 }>();
    const bounds = new THREE.Box3();
    for (const e of manifest.elements) {
      const geometry = new THREE.BoxGeometry(...e.dimensions.map(n => Math.max(n, .01)) as Vec3);
      const matrix = new THREE.Matrix4().fromArray(e.transform);
      geometry.computeBoundingBox(); if (geometry.boundingBox) bounds.union(geometry.boundingBox.clone().applyMatrix4(matrix));
      if (isFurniture(e)) {
        const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: ACTIVE, transparent: true, opacity: 0, depthWrite: false, depthTest: !useSplat }));
        fill.applyMatrix4(matrix); fill.userData.elementId = e.id; fill.renderOrder = 10;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: useSplat ? 0xffffff : INK, transparent: true, opacity: .7, depthTest: !useSplat }));
        edges.applyMatrix4(matrix); edges.renderOrder = 11;
        if (showBoxes) { group.add(fill, edges); picks.push(fill); }
        const center = new THREE.Vector3().setFromMatrixPosition(matrix);
        items.set(e.id, { edges, fill, center });
      } else if (!useSplat && isStructure(e)) {
        const plane = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: /floor/i.test(e.category) ? 0xd9dbd0 : 0xe6e6dc, transparent: true, opacity: /floor/i.test(e.category) ? .9 : .32, side: THREE.DoubleSide, depthWrite: /floor/i.test(e.category) }));
        plane.applyMatrix4(matrix); plane.userData.elementId = e.id; group.add(plane); structure.push(plane);
      } else geometry.dispose();
    }
    // Markers live in their own group so adding or moving one never rebuilds the room or resets the camera.
    const pins = new THREE.Group(); pins.visible = showBoxes; group.add(pins);
    const placeMarkers = (list: SpatialMarker[]) => {
      pins.children.slice().forEach(o => { pins.remove(o); if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
      for (const m of list) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(.05, 16, 16), new THREE.MeshBasicMaterial({ color: m.reviewStatus === "confirmed" ? DAMAGE : m.reviewStatus === "rejected" ? 0x8a8a84 : CHECK, depthTest: !useSplat }));
        marker.position.fromArray(m.position); marker.renderOrder = 12; pins.add(marker);
        const ring = new THREE.Mesh(new THREE.RingGeometry(.07, .085, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: .9, depthTest: !useSplat }));
        ring.position.copy(marker.position); ring.renderOrder = 11; ring.userData.billboard = true; pins.add(ring);
      }
    };
    placeMarkers(markersRef.current);
    const cloudGroup = new THREE.Group(); group.add(cloudGroup);
    const placeCloud = (cloud: ObjectCloud | null) => {
      cloudGroup.children.slice().forEach(child => { cloudGroup.remove(child); if (child instanceof THREE.Points) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } });
      state.current.showCloud = !!cloud && cloud.positions.length >= 9;
      if (!state.current.showCloud || !cloud) { render(); return; }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(cloud.positions, 3));
      const rgb = new Float32Array(cloud.colors.length);
      for (let i = 0; i < cloud.colors.length; i++) rgb[i] = cloud.colors[i] / 255;
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(rgb, 3));
      const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: .02, vertexColors: true, sizeAttenuation: true, depthTest: !useSplat }));
      points.renderOrder = 13; cloudGroup.add(points); render();
    };
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const radius = bounds.isEmpty() ? 3 : Math.max(2, bounds.getSize(new THREE.Vector3()).length() * .7);
    const start = center.clone().add(new THREE.Vector3(radius * .85, radius * .8, radius * .95));

    let camera: THREE.PerspectiveCamera | undefined, controls: { target: THREE.Vector3; update: () => void; autoRotate: boolean; autoRotateSpeed: number } | undefined;
    let render: () => void = () => {};
    let canvas: HTMLCanvasElement | undefined;
    let dead = false, focusFrame = 0;
    const highlight = () => {
      const { selected, hovered, localHover, tones } = state.current;
      for (const [id, item] of items) {
        const active = id === selected || id === hovered || id === localHover, tone = tones[id];
        const toneColor = tone === "damage" ? DAMAGE : tone === "check" ? CHECK : useSplat ? 0xffffff : INK;
        const lineMaterial = item.edges.material as THREE.LineBasicMaterial, fillMaterial = item.fill.material as THREE.MeshBasicMaterial;
        lineMaterial.color.set(active ? ACTIVE : toneColor);
        lineMaterial.opacity = active ? 1 : tone ? .95 : useSplat ? .55 : .75;
        fillMaterial.color.set(active ? ACTIVE : toneColor);
        fillMaterial.opacity = state.current.showCloud && id === selected ? 0 : active ? (id === selected ? .24 : .16) : tone === "damage" ? .16 : tone ? .1 : 0;
      }
      // Hovering a row in the list labels the same piece in the room.
      const external = !localHover && (hovered || null);
      if (external && camera && canvas) {
        const at = items.get(external)?.center.clone().project(camera), rect = canvas.getBoundingClientRect(), host = element.getBoundingClientRect();
        if (at && at.z < 1) setTip({ text: names.get(external) || "Furniture", x: (at.x + 1) / 2 * rect.width + rect.left - host.left, y: (1 - at.y) / 2 * rect.height + rect.top - host.top }); else setTip(null);
      } else if (!localHover) setTip(null);
      render();
    };
    const focus = (id: string | null) => {
      if (!controls || !camera) return;
      const goal = id ? items.get(id)?.center : center; if (!goal) return;
      cancelAnimationFrame(focusFrame);
      const from = controls.target.clone(), began = performance.now();
      const step = () => { if (dead || !controls) return; const t = Math.min(1, (performance.now() - began) / 450), k = t * (2 - t); controls.target.lerpVectors(from, goal, k); controls.update(); render(); if (t < 1) focusFrame = requestAnimationFrame(step); };
      step();
    };
    scene.current = { highlight, focus, markers: list => { placeMarkers(list); render(); }, cloud: cloud => { placeCloud(cloud); highlight(); } };
    // ---- Pointer: hover outlines, click selects, double-click places a marker.
    const ray = new THREE.Raycaster();
    const hitAt = (event: MouseEvent, targets: THREE.Object3D[]) => { if (!canvas || !camera) return undefined; const rect = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera); return ray.intersectObjects(targets, false)[0]; };
    let down: { x: number; y: number } | null = null, moveFrame = 0;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onMove = (e: PointerEvent) => {
      if (down || moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0; if (dead) return;
        const hit = hitAt(e, picks), id = (hit?.object.userData.elementId as string | undefined) ?? null;
        if (id !== state.current.localHover) { state.current.localHover = id; callbacks.current.onHoverElement?.(id); highlight(); if (canvas) canvas.style.cursor = id ? "pointer" : ""; }
        const rect = element.getBoundingClientRect();
        setTip(id ? { text: names.get(id) || "Furniture", x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
      });
    };
    const onLeave = () => { state.current.localHover = null; callbacks.current.onHoverElement?.(null); setTip(null); highlight(); };
    const onUp = (e: PointerEvent) => {
      const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99; down = null;
      if (moved > 5) return;
      const hit = hitAt(e, picks); callbacks.current.onSelectElement?.((hit?.object.userData.elementId as string | undefined) ?? null);
    };
    const onDouble = (e: MouseEvent) => { const hit = hitAt(e, [...picks, ...structure]); if (hit) callbacks.current.onPick?.(hit.point.toArray() as Vec3, (hit.object.userData.elementId as string | undefined) ?? null); };
    const attach = () => { if (!canvas) return; canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerleave", onLeave); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("dblclick", onDouble); };
    const detach = () => { if (!canvas) return; canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("dblclick", onDouble); };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dispose = () => { group.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Points) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); };

    if (useSplat) {
      let viewer: import("@mkkellogg/gaussian-splats-3d").Viewer | undefined, visibility: IntersectionObserver | undefined;
      // Furniture outlines are drawn after the splat so they stay visible inside it.
      const overlay = new THREE.Scene(), top = new THREE.Scene(); top.add(group);
      setLoading(true);
      import("@mkkellogg/gaussian-splats-3d").then(async ({ Viewer, SceneFormat, RenderMode }) => {
        if (dead) return;
        viewer = new Viewer({ rootElement: element, threeScene: overlay, cameraUp: [0, 1, 0], initialCameraPosition: start.toArray(), initialCameraLookAt: center.toArray(), sharedMemoryForWorkers: false, gpuAcceleratedSort: false, renderMode: compact ? RenderMode.Always : RenderMode.OnChange, ignoreDevicePixelRatio: window.devicePixelRatio > 1.5 });
        const position = new THREE.Vector3(), orientation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
        if (splat?.registration) new THREE.Matrix4().fromArray(splat.registration.transform).decompose(position, orientation, scale);
        const self = viewer as unknown as { render: () => void; splatRenderReady: boolean; renderer: THREE.WebGLRenderer; camera: THREE.Camera };
        const base = self.render.bind(viewer);
        self.render = () => { base(); if (!self.splatRenderReady) return; group.traverse(o => { if (o.userData.billboard) o.quaternion.copy(self.camera.quaternion); }); const r = self.renderer, saved = r.autoClear; r.autoClear = false; r.render(top, self.camera); r.autoClear = saved; };
        await viewer.addSplatScene(splatUrl, { format: SceneFormat.Ply, showLoadingUI: false, progressiveLoad: true, position: position.toArray(), rotation: orientation.toArray(), scale: scale.toArray() });
        if (dead) return;
        camera = viewer.camera as THREE.PerspectiveCamera; controls = viewer.controls as typeof controls; canvas = viewer.renderer.domElement;
        render = () => viewer?.forceRenderNextFrame();
        if (controls) { controls.autoRotate = compact && !reduced; controls.autoRotateSpeed = .35; }
        attach(); viewer.start(); placeCloud(cloudRef.current); highlight(); setLoading(false);
        // The dashboard preview spins on its own: only render it while it is on screen.
        if (compact) { const v = viewer; visibility = new IntersectionObserver(([entry]) => { if (dead) return; const loop = v as unknown as { stop: () => void; selfDrivenModeRunning: boolean }; if (!entry.isIntersecting) loop.stop(); else if (!loop.selfDrivenModeRunning) v.start(); }); visibility.observe(element); }
        if (state.current.selected) focus(state.current.selected);
      }).catch(() => { if (!dead) { setLoading(false); setError("The 3D room could not be loaded. Switch to geometry to keep reviewing."); } });
      return () => { dead = true; visibility?.disconnect(); cancelAnimationFrame(focusFrame); cancelAnimationFrame(moveFrame); detach(); scene.current = null; void viewer?.dispose(); dispose(); element.replaceChildren(); };
    }

    const three = new THREE.Scene(); three.background = new THREE.Color("#f1f0ea"); three.add(group);
    three.add(new THREE.HemisphereLight(0xffffff, 0x8b9182, 2.4));
    const perspective = new THREE.PerspectiveCamera(48, 1, .01, 500); camera = perspective;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setError("3D rendering is unavailable in this browser."); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); element.appendChild(renderer.domElement); canvas = renderer.domElement;
    const orbit = new OrbitControls(perspective, renderer.domElement); orbit.enableDamping = true; orbit.autoRotate = compact && !reduced; orbit.autoRotateSpeed = .35; controls = orbit;
    perspective.position.copy(start); orbit.target.copy(center); orbit.update();
    let dirty = true; render = () => { dirty = true; };
    const resize = new ResizeObserver(() => { perspective.aspect = element.clientWidth / Math.max(1, element.clientHeight); perspective.updateProjectionMatrix(); renderer.setSize(element.clientWidth, element.clientHeight); dirty = true; }); resize.observe(element);
    orbit.addEventListener("change", () => { dirty = true; });
    attach(); placeCloud(cloudRef.current); highlight();
    renderer.setAnimationLoop(() => { orbit.update(); if (dirty || orbit.autoRotate) { group.traverse(o => { if (o.userData.billboard) o.quaternion.copy(perspective.quaternion); }); renderer.render(three, perspective); dirty = false; } });
    if (state.current.selected) focus(state.current.selected);
    return () => { dead = true; cancelAnimationFrame(focusFrame); cancelAnimationFrame(moveFrame); detach(); scene.current = null; resize.disconnect(); renderer.setAnimationLoop(null); orbit.dispose(); dispose(); three.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); renderer.dispose(); element.replaceChildren(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, mode, splatUrl, compact, aligned]);

  const selectedPiece = !compact && selectedElementId ? manifest.elements.find(e => e.id === selectedElementId && isFurniture(e)) : undefined;
  const selectedName = selectedPiece ? furnitureNames(manifest.elements.filter(isFurniture)).get(selectedPiece.id) : undefined;
  return <div className={`room-scene ${compact ? "room-scene-compact" : ""} ${className}`}>
    <div ref={root} className="room-scene-canvas" aria-label="3D room: hover furniture to outline it, click to select" />
    {loading && <div className="room-scene-loading is-live"><DotField /><p>Loading your room in 3D…</p></div>}
    {tip && <span className="room-scene-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span>}
    {!compact && splat && <div className="room-scene-modes" role="group" aria-label="3D view"><button type="button" aria-pressed={mode === "room"} onClick={() => setMode("room")}>Room</button><button type="button" aria-pressed={mode === "geometry"} onClick={() => setMode("geometry")}>Geometry</button></div>}
    {selectedPiece && <aside className="room-measure" aria-label="Selected furniture measurements"><b>{selectedName || "Furniture"}</b>{reconstruction ? <dl><dt>Width</dt><dd>{reconstruction.measurements.width.toFixed(2)} m</dd><dt>Height</dt><dd>{reconstruction.measurements.height.toFixed(2)} m</dd><dt>Depth</dt><dd>{reconstruction.measurements.depth.toFixed(2)} m</dd></dl> : <dl><dt>Width</dt><dd>{selectedPiece.dimensions[0].toFixed(2)} m</dd><dt>Height</dt><dd>{selectedPiece.dimensions[1].toFixed(2)} m</dd><dt>Depth</dt><dd>{selectedPiece.dimensions[2].toFixed(2)} m</dd></dl>}<p>{reconstructing ? "Rebuilding this piece from the inspection photos…" : reconstruction?.caption || "Measured from this scan. Shown because this piece is selected."}</p></aside>}
    {!compact && mode === "room" && splat && !aligned && <p className="room-scene-note">This reconstruction has no calibration, so furniture outlines are shown in Geometry view only.</p>}
    {error && <p className="room-scene-note" role="alert">{error}</p>}
  </div>;
}
