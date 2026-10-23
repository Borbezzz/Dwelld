"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SpatialManifest, SpatialMarker, Vec3 } from "@/lib/spatial/types";
export default function SpatialViewer({ manifest, markers, onPick, assetUrl, selectedElementId, compact=false }: { manifest: SpatialManifest; markers: SpatialMarker[]; onPick: (point: Vec3, elementId: string | null) => void; assetUrl: (name: string) => string; selectedElementId?: string; compact?:boolean }) {
  const root = useRef<HTMLDivElement>(null), callback = useRef(onPick);
  const [mode, setMode] = useState<"geometry" | "splat">(() => manifest.assets.some(a => a.kind === "splat") ? "splat" : "geometry"), [error, setError] = useState("");
  const [showBounds, setShowBounds] = useState(false);
  const boundsRef = useRef<THREE.Mesh[]>([]), boundsVisible = useRef(false);
  boundsVisible.current = showBounds;
  useEffect(() => { for (const mesh of boundsRef.current) (mesh.material as THREE.MeshBasicMaterial).opacity = showBounds || mesh.userData.elementId === selectedElementId ? .12 : 0; }, [showBounds, selectedElementId]);
  callback.current = onPick;
  const splat = manifest.assets.find(a => a.kind === "splat");
  const splatUrl = splat ? assetUrl(splat.name) : "";
  useEffect(() => {
    const element = root.current; if (!element) return;
    setError("");
    if (mode === "splat" && splatUrl) {
      let overlay: THREE.Scene | undefined;
      let dead = false, viewer: import("@mkkellogg/gaussian-splats-3d").Viewer | undefined;
      import("@mkkellogg/gaussian-splats-3d").then(async ({ Viewer, SceneFormat }) => {
        if (dead) return;
        overlay = new THREE.Scene();
        const clickable: THREE.Mesh[] = []; boundsRef.current = clickable;
        if (splat?.registration) {
          manifest.elements.forEach(e => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...e.dimensions.map(n => Math.max(n, .008)) as Vec3), new THREE.MeshBasicMaterial({ color: e.id === selectedElementId ? 0xffaa22 : 0x4d91ff, transparent: true, opacity: boundsVisible.current || e.id === selectedElementId ? .12 : 0, depthWrite: false })); mesh.applyMatrix4(new THREE.Matrix4().fromArray(e.transform)); mesh.userData.elementId = e.id; overlay!.add(mesh); clickable.push(mesh);
            if (!/wall|floor|door|window|opening/i.test(e.category)) {
              const dot = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 8), new THREE.MeshBasicMaterial({ color: e.id === selectedElementId ? 0xffaa22 : 0x4d91ff }));
              dot.position.setFromMatrixPosition(mesh.matrix); overlay!.add(dot);
            }
          });
          markers.forEach(m => { const marker = new THREE.Mesh(new THREE.SphereGeometry(.045, 12, 12), new THREE.MeshBasicMaterial({ color: m.reviewStatus === "confirmed" ? 0x168044 : 0xd5523c })); marker.position.fromArray(m.position); overlay!.add(marker); });
        }
        viewer = new Viewer({ rootElement: element, threeScene: overlay, cameraUp: [0, 1, 0], initialCameraPosition: [3, 3, 5], initialCameraLookAt: [0, 0, 0], sharedMemoryForWorkers: false, gpuAcceleratedSort: false });
        const position = new THREE.Vector3(), orientation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
        if (splat?.registration) new THREE.Matrix4().fromArray(splat.registration.transform).decompose(position, orientation, scale);
        await viewer.addSplatScene(splatUrl, { format: SceneFormat.Ply, showLoadingUI: true, position: position.toArray(), rotation: orientation.toArray(), scale: scale.toArray() });
        if (!dead) {
          if (viewer.controls) { viewer.controls.autoRotate = compact && !window.matchMedia("(prefers-reduced-motion: reduce)").matches; viewer.controls.autoRotateSpeed = .3; }
          viewer.start();
          if (splat?.registration) viewer.renderer.domElement.ondblclick = event => { if (!viewer) return; const rect = viewer.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), viewer.camera); const hit = ray.intersectObjects(clickable)[0]; if (hit) callback.current(hit.point.toArray() as Vec3, hit.object.userData.elementId); };
        }
      }).catch(() => { if (!dead) setError("The reconstruction could not be loaded. The Gaussian PLY could not be decoded."); });
      return () => { dead = true; boundsRef.current = []; void viewer?.dispose(); overlay?.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); element.replaceChildren(); };
    }
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#eef1ed");
    const camera = new THREE.PerspectiveCamera(50, 1, .01, 2000);
    let renderer: THREE.WebGLRenderer;try {renderer = new THREE.WebGLRenderer({ antialias: true });}catch{setError("3D rendering is unavailable. Enable WebGL in this browser or open the inspection on another device.");return;} renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.autoRotate=compact&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches;controls.autoRotateSpeed=.3;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334433, 2));
    const clickable: THREE.Mesh[] = [];
    manifest.elements.forEach(e => {
      // Zero-thickness measured surfaces are displayed as thin planes; no metric is changed in storage.
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...e.dimensions.map(n => Math.max(n, .008)) as Vec3), new THREE.MeshStandardMaterial({ color: e.id === selectedElementId ? 0xffaa22 : /wall|floor/.test(e.category) ? 0xa4b9a7 : 0x577cc0, transparent: true, opacity: .58, side: THREE.DoubleSide }));
      mesh.applyMatrix4(new THREE.Matrix4().fromArray(e.transform)); mesh.userData.elementId = e.id; scene.add(mesh); clickable.push(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x28403a })); edges.applyMatrix4(mesh.matrix); scene.add(edges);
    });
    markers.forEach(m => { const sphere = new THREE.Mesh(new THREE.SphereGeometry(.045, 12, 12), new THREE.MeshBasicMaterial({ color: m.reviewStatus === "confirmed" ? 0x168044 : m.reviewStatus === "rejected" ? 0x777777 : 0xd5523c })); sphere.position.fromArray(m.position); scene.add(sphere); });
    const bounds = new THREE.Box3().setFromObject(scene), center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3()), extent = bounds.isEmpty() ? 4 : Math.max(2, bounds.getSize(new THREE.Vector3()).length());
    camera.position.copy(center).add(new THREE.Vector3(extent * .6, extent * .5, extent * .6)); controls.target.copy(center); controls.update();
    const resize = new ResizeObserver(() => { camera.aspect = element.clientWidth / Math.max(1, element.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(element.clientWidth, element.clientHeight); }); resize.observe(element);
    const pick = (event: MouseEvent) => { const rect = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera); const hit = ray.intersectObjects(clickable)[0]; if (hit) callback.current(hit.point.toArray() as Vec3, hit.object.userData.elementId || null); };
    renderer.domElement.addEventListener("dblclick", pick);
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    return () => { resize.disconnect(); renderer.setAnimationLoop(null); controls.dispose(); renderer.domElement.removeEventListener("dblclick", pick); scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); renderer.dispose(); element.replaceChildren(); };
  }, [manifest, markers, mode, splatUrl, selectedElementId, compact]);
  return <section>{!compact&&<><div className="flex gap-3 py-2"><button onClick={() => setMode("geometry")} className="rounded border px-3 py-2">Measured geometry</button><button disabled={!splat} onClick={() => setMode("splat")} className="rounded border px-3 py-2 disabled:opacity-40">{splat?.reconstructionMethod === "lidar-initialized" ? "LiDAR splat preview" : "Gaussian reconstruction"}</button>{mode === "splat" && <label className="flex items-center gap-2"><input type="checkbox" checked={showBounds} onChange={e => setShowBounds(e.target.checked)} />Show object bounds</label>}</div><p className="text-sm">Drag to orbit, scroll to zoom. Double-click measured geometry to place or move a marker. Reconstruction appearance is not a measurement. {splat?.reconstructionMethod === "lidar-initialized" && "This preview uses measured LiDAR samples with Gaussian footprints; photometric training has not been performed. Unscanned areas may have gaps."} {mode === "splat" && (splat?.registration ? "Overlay uses supplied calibration; visually verify alignment before confirming." : "Unregistered reconstruction: world markers and measured geometry are hidden.")}</p></>}<div ref={root} className={`relative w-full overflow-hidden ${compact?"h-[400px]":"h-[520px]"}`} aria-label="Measured room geometry viewer" />{error && <p role="alert">{error}</p>}</section>;
}
