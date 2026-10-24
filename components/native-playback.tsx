"use client";
import {useState} from 'react';
import type {Finding} from '@/lib/types';
import type {SpatialManifest} from '@/lib/spatial/types';
import {recordedSegments,findingsInRecording} from '@/lib/client/native-playback';
import WalkthroughPlayer from './walkthrough-player';
export default function NativePlayback({assets,findings,selectedId,assetUrl,onSelect}:{assets:SpatialManifest['assets'];findings:Finding[];selectedId?:string;assetUrl:(name:string)=>string;onSelect:(id:string)=>void}){
 const recordings=recordedSegments(assets),[chosen,setChosen]=useState({name:'',selection:selectedId});
 const selected=findings.find(f=>f.id===selectedId),target=selected?.timestampSeconds;
 const matching=target==null?undefined:recordings.find(a=>target>=a.startTimeSeconds!&&target<a.startTimeSeconds!+a.durationSeconds!);
 const active=(chosen.selection===selectedId?recordings.find(a=>a.name===chosen.name):undefined)||matching||recordings[0];
 if(!active)return null;
 return <div className="native-playback">
  <div className="native-playback-heading"><span>Recorded walkthrough · 30 FPS</span>{recordings.length>1&&<label>Scan segment<select aria-label="Recorded scan segment" value={active.name} onChange={e=>setChosen({name:e.target.value,selection:selectedId})}>{recordings.map((a,i)=><option key={a.name} value={a.name}>Scan {i+1} · {Math.floor(a.startTimeSeconds!)}s</option>)}</select></label>}</div>
  <WalkthroughPlayer key={active.mediaRef} src={assetUrl(active.name)} findings={findingsInRecording(findings,active)} selectedId={selectedId} onSelect={id=>{setChosen({name:'',selection:selectedId});onSelect(id)}} showOverlays={false}/>
 </div>;
}
