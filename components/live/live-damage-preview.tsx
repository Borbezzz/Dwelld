'use client';
import {useCallback,useEffect,useState,type RefObject} from 'react';
import type {LiveFinding} from '@/lib/live/types';
import type {VideoMarker} from '@/lib/client/live-markers';
import {timelineGroups} from '@/lib/inspection-timeline';
const clock=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
/** Evidence is an inset. Selecting or hovering a finding never hides or pauses the live video. */
export default function LiveDamagePreview({sessionId,token,findings,preview,selectedId,onSelect,videoRef,videoConnected,videoMarkers,onVideoReady,onVideoElement,finished=false,receivedFps}:{sessionId:string;token:string;findings:LiveFinding[];preview?:string;selectedId?:string|null;onSelect:(id:string)=>void;videoRef:RefObject<HTMLVideoElement|null>;videoConnected:boolean;videoMarkers:VideoMarker[];onVideoReady:()=>void;onVideoElement?:(element:HTMLVideoElement|null)=>void;finished?:boolean;receivedFps?:number|null}){
 const visible=findings.filter(f=>f.reviewStatus!=='rejected'&&(f.evidenceFrameRef||f.evidenceFrameUrl));
 const latest=visible.reduce<LiveFinding|undefined>((last,f)=>!last||(f.timestampSeconds??0)>=(last.timestampSeconds??0)?f:last,undefined);
 const selected=visible.find(f=>f.id===selectedId)||latest,ref=selected?.evidenceFrameRef||selected?.evidenceFrameUrl;
 const [photo,setPhoto]=useState<{ref:string;url:string}|null>(null),[inspect,setInspect]=useState(false),[message,setMessage]=useState(''),[ratio,setRatio]=useState(9/16);
 const attach=useCallback((element:HTMLVideoElement|null)=>{videoRef.current=element;onVideoElement?.(element);},[videoRef,onVideoElement]);
 const selectedExists=visible.some(f=>f.id===selectedId);
 useEffect(()=>{if(selectedId&&selectedExists)setInspect(true);},[selectedId,selectedExists]);
 useEffect(()=>{if(!ref||!token)return;const controller=new AbortController();let url='';setMessage('');
  void fetch(`/api/live/${sessionId}/media?ref=${encodeURIComponent(ref)}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('The source photo could not load. Live video continues.');return r.blob();}).then(blob=>{if(!controller.signal.aborted){url=URL.createObjectURL(blob);setPhoto({ref,url});}}).catch(e=>{if(!controller.signal.aborted)setMessage(e.message);});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[sessionId,token,ref]);
 const marks=visible.filter(f=>(f.evidenceFrameRef||f.evidenceFrameUrl)===ref),groups=timelineGroups(visible);
 return <section className="live-evidence-player" aria-label="Live camera and marked source evidence">
 <header><b>{finished?'Capture saved · connection closed':videoConnected?`Live camera${receivedFps!=null?` · ${receivedFps} FPS`:''}`:'Preview only · reconnecting live video…'}</b>{ref&&<button type="button" className="text-button" onClick={()=>setInspect(v=>!v)}>{inspect?'Close source frame':'Inspect source frame'}</button>}</header>
 <div className="live-evidence-stage">
  <div className="live-camera-frame" style={{aspectRatio:ratio,maxWidth:`calc(56vh * ${ratio})`}}>
   <video ref={attach} autoPlay playsInline muted onPlaying={onVideoReady} onLoadedMetadata={e=>{const v=e.currentTarget;if(v.videoWidth&&v.videoHeight)setRatio(v.videoWidth/v.videoHeight);}}/>
   {!videoConnected&&preview&&<img className="live-video-fallback" src={preview} alt="Last phone preview; live video is reconnecting"/>}
   {!videoConnected&&!preview&&<p className="live-camera-wait">Waiting for the live camera. Use Reconnect video if this continues.</p>}
   {videoConnected&&videoMarkers.map(f=><button type="button" key={f.id} className={`walkthrough-mark ${f.kind==='damage'?'is-damage':'is-object'} ${f.point?'is-pin':''}`} aria-label={`${f.kind}: ${f.label}`} title={findings.find(item=>item.id===f.id)?.description||f.label} style={f.boundingBox?{left:`${f.boundingBox.x*100}%`,top:`${f.boundingBox.y*100}%`,width:`${f.boundingBox.width*100}%`,height:`${f.boundingBox.height*100}%`}:{left:`${f.point!.x*100}%`,top:`${f.point!.y*100}%`}} onClick={()=>{if(f.kind==='damage'){setInspect(true);onSelect(f.id);}}}><span>{f.label}</span></button>)}
  </div>
  {inspect&&ref&&<aside className="live-source-inset" aria-label="Selected source frame"><header><b>Source photo · {clock(selected?.timestampSeconds??0)}</b><button type="button" aria-label="Close source frame" onClick={()=>setInspect(false)}>×</button></header><div className="live-source-photo">{photo?.ref===ref?<><img src={photo.url} alt="Selected source photo; live camera continues"/>{marks.map(f=>f.boundingBox?<button type="button" key={f.id} className="walkthrough-mark is-damage" aria-label={`Source damage: ${f.label}`} title={f.description||f.label} style={{left:`${f.boundingBox.x*100}%`,top:`${f.boundingBox.y*100}%`,width:`${f.boundingBox.width*100}%`,height:`${f.boundingBox.height*100}%`}} onClick={()=>onSelect(f.id)}/>:null)}</>:<p>Loading source photo…</p>}</div><p>{selected?.description||'Potential damage requires review.'}</p></aside>}
 </div>
 {groups.length>0&&<nav aria-label="Source photo timeline">{groups.map(g=><button type="button" key={g.time} className="button button-outline" aria-current={selected&&Math.abs((selected.timestampSeconds??0)-g.time)<.01?'true':undefined} onClick={()=>{setInspect(true);onSelect(g.items[0].id);}}>{clock(g.time)} · {g.items.length}</button>)}</nav>}
 <p className="live-evidence-caption">{finished?'Open your saved room to review observations and remaining analysis.':'Camera stays live. Blue boxes: measured furniture. Red pins: located damage candidates. Timestamps open a source-photo inset.'}</p>{message&&<p role="status">{message}</p>}
 </section>;
}
