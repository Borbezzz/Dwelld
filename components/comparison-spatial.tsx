"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import {useEffect,useState} from "react";
import type {SpatialManifest,SpatialMarker} from "@/lib/spatial/types";
const SpatialViewer=dynamic(()=>import("@/components/spatial-viewer"),{ssr:false,loading:()=> <p>Loading spatial view…</p>});
type Capture={capture:{manifest:SpatialManifest}|null;markers:SpatialMarker[]};
function CaptureSide({inspectionId,label,selectedFindingId}:{inspectionId:string;label:string;selectedFindingId?:string|null}){
 const [data,setData]=useState<Capture|null>(null),[error,setError]=useState("");
 useEffect(()=>{const abort=new AbortController();setData(null);setError("");fetch(`/api/inspections/${inspectionId}/spatial`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw new Error("Spatial capture could not be loaded.");return r.json() as Promise<Capture>;}).then(setData).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[inspectionId]);
 return <section><h3>{label}</h3>{error?<p role="alert">{error}</p>:!data?<p>Loading capture…</p>:data.capture?<><SpatialViewer manifest={data.capture.manifest} markers={data.markers} selectedElementId={data.markers.find(m=>m.findingId===selectedFindingId)?.elementId||undefined} onPick={()=>{}} assetUrl={name=>`/api/inspections/${inspectionId}/spatial/assets/${encodeURIComponent(name)}`}/><p>{data.markers.length} independently positioned markers.</p></>:<p>No native spatial capture attached.</p>}<Link href={`/inspections/${inspectionId}/spatial`}>Review this inspection’s spatial markers →</Link></section>;
}
export default function ComparisonSpatial({baselineInspectionId,currentInspectionId,baselineFindingId,currentFindingId}:{baselineInspectionId:string;currentInspectionId:string;baselineFindingId?:string|null;currentFindingId?:string|null}){return <details open={!!baselineFindingId||!!currentFindingId}><summary>Compare spatial captures</summary><p>Each capture retains its own coordinate frame. Marker positions are not automatically transferred between scans; a shared label does not establish spatial correspondence.</p><div className="compare-pair"><CaptureSide inspectionId={baselineInspectionId} label="Move-in spatial record" selectedFindingId={baselineFindingId}/><CaptureSide inspectionId={currentInspectionId} label="Move-out spatial record" selectedFindingId={currentFindingId}/></div></details>;}
