"use client";
import dynamic from "next/dynamic";
import {useEffect,useState} from "react";
import type {SpatialManifest,SpatialMarker} from "@/lib/spatial/types";
const SpatialViewer=dynamic(()=>import("@/components/spatial-viewer"),{ssr:false,loading:()=> <p>Loading spatial view…</p>});
type Capture={capture:{manifest:SpatialManifest}|null;markers:SpatialMarker[]};
function CaptureSide({inspectionId,label,selectedFindingId}:{inspectionId:string;label:string;selectedFindingId?:string|null}){
 const [data,setData]=useState<Capture|null>(null),[error,setError]=useState("");
 useEffect(()=>{const abort=new AbortController();setData(null);setError("");fetch(`/api/inspections/${inspectionId}/spatial`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw new Error("Spatial capture could not be loaded.");return r.json() as Promise<Capture>;}).then(setData).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[inspectionId]);
 return <section><h3>{label}</h3>{error?<p role="alert">{error}</p>:!data?<p>Loading capture…</p>:data.capture?<><SpatialViewer manifest={data.capture.manifest} markers={data.markers} selectedElementId={data.markers.find(m=>m.findingId===selectedFindingId)?.elementId||null} assetUrl={name=>`/api/inspections/${inspectionId}/spatial/assets/${encodeURIComponent(name)}`}/></>:<p className="compare-muted">This scan has no 3D room.</p>}</section>;
}
export default function ComparisonSpatial({baselineInspectionId,currentInspectionId,baselineFindingId,currentFindingId}:{baselineInspectionId:string;currentInspectionId:string;baselineFindingId?:string|null;currentFindingId?:string|null}){return <details className="compare-3d" open={!!baselineFindingId||!!currentFindingId}><summary>Both rooms in 3D</summary><p className="compare-muted">Each scan keeps its own coordinates, so the two rooms are shown side by side rather than overlaid.</p><div className="compare-pair"><CaptureSide inspectionId={baselineInspectionId} label="Move-in" selectedFindingId={baselineFindingId}/><CaptureSide inspectionId={currentInspectionId} label="Move-out" selectedFindingId={currentFindingId}/></div></details>;}
