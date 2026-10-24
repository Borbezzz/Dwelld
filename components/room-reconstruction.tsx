"use client";
import {useEffect,useState} from 'react';
import DotField from './dot-field';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type {Inspection} from '@/lib/types';
import type {SpatialManifest,SpatialMarker} from '@/lib/spatial/types';
const RoomScene=dynamic(()=>import('./spatial-viewer'),{ssr:false,loading:()=><div className="room-scene room-scene-compact"><div className="room-scene-loading is-live"><DotField /></div></div>});
/** Dashboard preview of the selected room: the latest scan's splat with its furniture outlines. */
export default function RoomReconstruction({roomId,name,inspections,hint=false,loading=false}:{loading?:boolean;roomId:string;name:string;inspections:Inspection[];hint?:boolean}){
 const [scene,setScene]=useState<{manifest:SpatialManifest;markers:SpatialMarker[];inspectionId:string}|null>(null),[status,setStatus]=useState('');
 useEffect(()=>{const controller=new AbortController();setScene(null);setStatus(roomId?'loading':'Choose a room to view it in 3D.');if(!roomId||loading)return;
  void(async()=>{try{
   const candidates=inspections.filter(i=>i.roomId===roomId&&(i.status==='completed'||i.status==='partial'||i.status==='processing'));
   // Probe in small parallel batches, preserving inspection order while avoiding an N-request waterfall.
   for(let offset=0;offset<candidates.length;offset+=3){
    const batch=await Promise.all(candidates.slice(offset,offset+3).map(async inspection=>{
     try{const response=await fetch(`/api/inspections/${inspection.id}/spatial`,{signal:controller.signal});if(!response.ok)return null;
      const data=await response.json() as {capture?:{manifest:SpatialManifest};markers?:SpatialMarker[]};
      return data.capture?.manifest&&(data.capture.manifest.elements.length||data.capture.manifest.assets.some(a=>a.kind==='splat'))?{manifest:data.capture.manifest,markers:data.markers||[],inspectionId:inspection.id}:null;
     }catch(e){if(controller.signal.aborted)throw e;return null;}
    }));
    if(controller.signal.aborted)return;
    const found=batch.find(Boolean);if(found){setScene(found);setStatus('');return;}
   }
   if(!controller.signal.aborted)setStatus(candidates.length?'This room has video walkthroughs only. A LiDAR scan from the iPhone app adds the 3D room.':'Your room in 3D appears here after its first LiDAR scan.');
  }catch(e){if(!controller.signal.aborted)setStatus(e instanceof Error?e.message:'Could not load the room.');}})();
  return()=>controller.abort();
 },[roomId,inspections,loading]);
 return <aside className="room-reconstruction" aria-label="Room in 3D"><div className="reconstruction-heading"><span><span className="reconstruction-index" aria-hidden="true">3D /</span> {name||'Your room, in 3D'}</span>{hint&&<small>Pick a room on the left to see it here</small>}</div>
  {!loading&&scene?<RoomScene compact manifest={scene.manifest} markers={scene.markers} assetUrl={n=>`/api/inspections/${scene.inspectionId}/spatial/assets/${encodeURIComponent(n)}`} onSelectElement={()=>{}}/>
   :loading||status==='loading'?<div className="room-scene room-scene-compact"><div className="room-scene-loading is-live"><DotField /><p>Loading your room…</p></div></div>
   :<div className="room-scene room-scene-compact"><div className="room-scene-loading is-live"><DotField /><p>{status||"Choose a room to view it in 3D."}</p></div></div>}
  <div className="reconstruction-footer">{roomId?<Link href={`/rooms/${roomId}`}>Open room ↗</Link>:<span>Your rooms in 3D</span>}</div></aside>;
}
