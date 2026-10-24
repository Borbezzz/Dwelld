"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type {Inspection} from '@/lib/types';
import type {SpatialManifest,SpatialMarker} from '@/lib/spatial/types';
const RoomScene=dynamic(()=>import('./spatial-viewer'),{ssr:false,loading:()=><div className="room-scene room-scene-compact"><div className="room-scene-loading"><span className="skeleton"/></div></div>});
/** Dashboard preview: render measured geometry without fetching the large splat. */
export default function RoomReconstruction({roomId,name,inspections,hint=false}:{roomId:string;name:string;inspections:Inspection[];hint?:boolean}){
 const [scene,setScene]=useState<{manifest:SpatialManifest;markers:SpatialMarker[];inspectionId:string}|null>(null),[status,setStatus]=useState('');
 useEffect(()=>{const controller=new AbortController();setScene(null);setStatus(roomId?'loading':'Choose a room to view it in 3D.');if(!roomId)return;
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
   if(!controller.signal.aborted)setStatus('Your room in 3D appears here after its first LiDAR scan.');
  }catch(e){if(!controller.signal.aborted)setStatus(e instanceof Error?e.message:'Could not load the room.');}})();
  return()=>controller.abort();
 },[roomId,inspections]);
 return <aside className="room-reconstruction" aria-label="Room in 3D"><div className="reconstruction-heading"><span>{name||'Your room, in 3D'}</span>{hint&&<small>Pick a room on the left to see it here</small>}</div>
  {scene?<RoomScene compact manifest={scene.manifest} markers={scene.markers} assetUrl={n=>`/api/inspections/${scene.inspectionId}/spatial/assets/${encodeURIComponent(n)}`} onSelectElement={()=>{}}/>
   :status==='loading'?<div className="room-scene room-scene-compact"><div className="room-scene-loading"><span className="skeleton"/><p>Loading your room…</p></div></div>
   :<div className="reconstruction-canvas"><div className="reconstruction-message" role="status"><h3>A space to return to.</h3><p>{status}</p></div></div>}
  <div className="reconstruction-footer">{roomId?<Link href={`/rooms/${roomId}`}>Open room ↗</Link>:<span>Your rooms in 3D</span>}</div></aside>;
}
