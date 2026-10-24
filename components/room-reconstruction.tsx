"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type {Inspection} from '@/lib/types';
import type {SpatialManifest,SpatialMarker} from '@/lib/spatial/types';
const RoomScene=dynamic(()=>import('./spatial-viewer'),{ssr:false,loading:()=><div className="room-scene room-scene-compact"><div className="room-scene-loading"><span className="skeleton"/></div></div>});
/** Dashboard preview of the selected room: the latest scan's splat with its furniture outlines. */
export default function RoomReconstruction({roomId,name,inspections}:{roomId:string;name:string;inspections:Inspection[]}){
 const [scene,setScene]=useState<{manifest:SpatialManifest;markers:SpatialMarker[];inspectionId:string}|null>(null),[status,setStatus]=useState('');
 useEffect(()=>{const controller=new AbortController();setScene(null);setStatus(roomId?'loading':'Choose a room to view it in 3D.');if(!roomId)return;
  void(async()=>{try{for(const inspection of inspections.filter(i=>i.roomId===roomId&&(i.status==='completed'||i.status==='partial'))){
   const response=await fetch(`/api/inspections/${inspection.id}/spatial`,{signal:controller.signal});if(!response.ok)continue;
   const data=await response.json() as {capture?:{manifest:SpatialManifest};markers?:SpatialMarker[]};
   if(data.capture?.manifest&&(data.capture.manifest.elements.length||data.capture.manifest.assets.some(a=>a.kind==='splat'))){if(!controller.signal.aborted){setScene({manifest:data.capture.manifest,markers:data.markers||[],inspectionId:inspection.id});setStatus('');}return;}}
   if(!controller.signal.aborted)setStatus('Your room in 3D appears here after its first LiDAR scan.');}catch(e){if(!controller.signal.aborted)setStatus(e instanceof Error?e.message:'Could not load the room.');}})();
  return()=>controller.abort();
 },[roomId,inspections]);
 return <aside className="room-reconstruction" aria-label="Room in 3D"><div className="reconstruction-heading"><span>{name||'Your room, in 3D'}</span></div>
  {scene?<RoomScene compact manifest={scene.manifest} markers={scene.markers} assetUrl={n=>`/api/inspections/${scene.inspectionId}/spatial/assets/${encodeURIComponent(n)}`} onSelectElement={()=>{}}/>
   :status==='loading'?<div className="room-scene room-scene-compact"><div className="room-scene-loading"><span className="skeleton"/><p>Loading your room…</p></div></div>
   :<div className="reconstruction-canvas"><div className="reconstruction-message" role="status"><h3>A space to return to.</h3><p>{status}</p></div></div>}
  <div className="reconstruction-footer">{roomId?<Link href={`/rooms/${roomId}`}>Open room ↗</Link>:<span>Your rooms in 3D</span>}</div></aside>;
}
