"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
const MeasuredViewer=dynamic(()=>import('./spatial-viewer'),{ssr:false});
import type {Inspection} from '@/lib/types';
import type {SpatialManifest} from '@/lib/spatial/types';
export default function RoomReconstruction({roomId,name,inspections}:{roomId:string;name:string;inspections:Inspection[]}){
 const [geometry,setGeometry]=useState<{manifest:SpatialManifest;inspectionId:string}|null>(null);
 const root=useRef<HTMLDivElement>(null),[scene,setScene]=useState<{url:string;inspectionId:string}|null>(null),[status,setStatus]=useState(''),[paused,setPaused]=useState(false);
 const viewerRef=useRef<import('@mkkellogg/gaussian-splats-3d').Viewer|null>(null);
 useEffect(()=>{const controller=new AbortController();setScene(null);setGeometry(null);setStatus(roomId?'Looking for a saved reconstruction…':'Choose a room to view its reconstruction.');if(!roomId)return;
 void(async()=>{try{for(const inspection of inspections.filter(i=>i.roomId===roomId)){
 const response=await fetch(`/api/inspections/${inspection.id}/spatial`,{signal:controller.signal});if(!response.ok)throw new Error('Could not load the room reconstruction.');
 const data=await response.json() as {capture?:{manifest:SpatialManifest}};if(data.capture?.manifest.elements.length){if(!controller.signal.aborted)setGeometry(current=>current||{manifest:data.capture!.manifest,inspectionId:inspection.id});}const splat=data.capture?.manifest.assets.find(a=>a.kind==='splat');if(splat){if(!controller.signal.aborted)setScene({url:`/api/inspections/${inspection.id}/spatial/assets/${encodeURIComponent(splat.name)}`,inspectionId:inspection.id});return;}}
 if(!controller.signal.aborted)setStatus('Your room in 3D, once a reconstruction is saved.');}catch(e){if(!controller.signal.aborted)setStatus(e instanceof Error?e.message:'Could not load reconstruction.');}})();return()=>controller.abort();
 },[roomId,inspections]);
 useEffect(()=>{const element=root.current;if(!element||!scene)return;let dead=false;let viewer:import('@mkkellogg/gaussian-splats-3d').Viewer|undefined;setStatus('Loading your room…');
 void import('@mkkellogg/gaussian-splats-3d').then(async({Viewer,SceneFormat})=>{if(dead)return;viewer=new Viewer({rootElement:element,cameraUp:[0,1,0],initialCameraPosition:[3,3,5],initialCameraLookAt:[0,0,0],sharedMemoryForWorkers:false,gpuAcceleratedSort:false});viewerRef.current=viewer;await viewer.addSplatScene(scene.url,{format:SceneFormat.Ply,showLoadingUI:false});if(dead)return;if(viewer.controls){viewer.controls.autoRotate=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;viewer.controls.autoRotateSpeed=.3;}setPaused(window.matchMedia('(prefers-reduced-motion: reduce)').matches);viewer.start();setStatus('');}).catch(()=>{if(!dead)setStatus('This reconstruction could not be displayed. Open the inspection to review its source.');});return()=>{dead=true;viewerRef.current=null;void viewer?.dispose();element.replaceChildren();};},[scene]);
 function toggle(){setPaused(p=>{if(viewerRef.current?.controls)viewerRef.current.controls.autoRotate=p;return !p;});}
 return <aside className="room-reconstruction" aria-label="Room reconstruction"><div className="reconstruction-heading"><span>{name||'Your room, in 3D'}</span>{scene&&<button onClick={toggle}>{paused?'Rotate slowly':'Pause rotation'}</button>}</div>{geometry&&!scene?<MeasuredViewer manifest={geometry.manifest} markers={[]} onPick={()=>{}} assetUrl={name=>`/api/inspections/${geometry.inspectionId}/spatial/assets/${encodeURIComponent(name)}`} compact/>:<div className="reconstruction-canvas" ref={root}/>}{status&&!geometry&&<div className="reconstruction-message" role="status"><h3>{scene?'Your room, taking shape.':'A space to return to.'}</h3><p>{status}</p>{!scene&&<small>No reconstruction has been generated for this view.</small>}</div>}<div className="reconstruction-footer">{scene?<Link href={`/inspections/${scene.inspectionId}/spatial`}>Explore room ↗</Link>:geometry?<Link href={`/inspections/${geometry.inspectionId}/spatial`}>Measured LiDAR geometry · Explore ↗</Link>:<span>Saved Gaussian reconstruction</span>}</div></aside>;
}
