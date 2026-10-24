"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronRight,LoaderCircle,Pause,Play} from 'lucide-react';
import type {Finding} from '@/lib/types';
import {findingsAtTime,timelineGroups} from '@/lib/inspection-timeline';
const clock=(time:number)=>`${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}`;
export default function WalkthroughPlayer({src,findings,selectedId,onSelect,processing=false}:{src:string;findings:Finding[];selectedId?:string;onSelect:(id:string)=>void;processing?:boolean}){
 const video=useRef<HTMLVideoElement>(null),pending=useRef<number|null>(null);
 const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[ratio,setRatio]=useState(16/9),[playing,setPlaying]=useState(false),[error,setError]=useState(''),[hover,setHover]=useState('');
 const groups=timelineGroups(findings),visible=findingsAtTime(findings,time),selected=findings.find(f=>f.id===selectedId);
 const seek=useCallback((t:number)=>{const v=video.current;if(!v)return;v.pause();pending.current=t;if(v.readyState>=1){v.currentTime=Math.max(0,Math.min(t,Number.isFinite(v.duration)?v.duration:t));pending.current=null;setTime(v.currentTime);}},[]);
 useEffect(()=>{if(selected?.timestampSeconds!=null)seek(selected.timestampSeconds);},[selected?.id,selected?.timestampSeconds,seek]);
 function select(f:Finding){seek(f.timestampSeconds??0);onSelect(f.id);}
 const detail=visible.find(f=>f.id===hover)||visible.find(f=>f.id===selectedId);
 const next=groups.find(g=>g.damage&&g.time>time+.4);
 return <section className="walkthrough-player" aria-label="Walkthrough video with findings">
  <div className="walkthrough-stage" style={{aspectRatio:ratio}}>
   <video ref={video} src={src} playsInline preload="metadata" onLoadedMetadata={e=>{const v=e.currentTarget;setDuration(Number.isFinite(v.duration)?v.duration:0);if(v.videoWidth&&v.videoHeight)setRatio(v.videoWidth/v.videoHeight);if(pending.current!=null){v.currentTime=pending.current;pending.current=null;}}} onDurationChange={e=>{if(Number.isFinite(e.currentTarget.duration))setDuration(e.currentTarget.duration);}} onLoadedData={e=>{if(Number.isFinite(e.currentTarget.duration))setDuration(e.currentTarget.duration);}} onCanPlay={e=>{if(Number.isFinite(e.currentTarget.duration))setDuration(e.currentTarget.duration);}} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onSeeked={e=>setTime(e.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>setError('The walkthrough could not load. Retry loading the record; your saved findings remain available.')} />
   <div className="walkthrough-marks" aria-label="Findings at this moment">{visible.map(f=>{
    const b=f.boundingBox,p=f.point;if(!b&&!p)return null;
    return <button key={f.id} type="button" aria-label={`${f.kind==='damage'?'Damage':'Object'}: ${f.label}`} className={`walkthrough-mark ${f.kind==='damage'?'is-damage':'is-object'} ${f.id===selectedId?'is-selected':''} ${p?'is-pin':''}`} style={b?{left:`${b.x*100}%`,top:`${b.y*100}%`,width:`${b.width*100}%`,height:`${b.height*100}%`}:{left:`${p!.x*100}%`,top:`${p!.y*100}%`}} onMouseEnter={()=>setHover(f.id)} onMouseLeave={()=>setHover('')} onFocus={()=>setHover(f.id)} onBlur={()=>setHover('')} onClick={()=>select(f)}><span>{f.label}</span></button>;
   })}</div>
   <span className="walkthrough-stamp">{clock(time)} · {visible.length} marked observations</span>
   {processing&&<span className="walkthrough-live"><LoaderCircle size={12} className="spin"/> Checking saved frames</span>}
  </div>
  <div className="walkthrough-controls"><button type="button" aria-label={playing?'Pause walkthrough':'Play walkthrough'} onClick={()=>{const v=video.current;if(!v)return;if(v.paused)void v.play().catch(()=>setError('Tap Play again to start this video.'));else v.pause();}}>{playing?<Pause size={17}/>:<Play size={17}/>}</button><time>{clock(time)} / {clock(duration)}</time><span>Hover a box for details</span><button type="button" disabled={!next} onClick={()=>{if(next)select(next.items.find(f=>f.kind==='damage')!);}}>Next finding <ChevronRight size={15}/></button></div>
  <div className="walkthrough-timeline"><input aria-label="Walkthrough timeline" type="range" min={0} max={duration||1} step={.01} value={Math.min(time,duration||1)} disabled={!duration} onChange={e=>seek(Number(e.target.value))}/><div className="walkthrough-ticks" aria-label="Finding markers">{groups.map(g=><button type="button" key={g.time} disabled={!duration} className={g.damage?'is-damage':'is-object'} style={{left:`${Math.max(0,Math.min(100,g.time/(duration||1)*100))}%`}} aria-label={`Show ${g.items.length} ${g.damage?'damage findings':'objects'} at ${clock(g.time)}`} aria-current={Math.abs(time-g.time)<.4?'true':undefined} title={`${clock(g.time)} · ${g.items.map(f=>f.label).join(', ')}`} onClick={()=>select(g.items.find(f=>f.kind==='damage')||g.items[0])}/> )}</div></div>
  <div className="walkthrough-detail" aria-live="polite">{detail?<><b>{detail.label}</b><p>{detail.description||'Review this observation against the original walkthrough.'}</p><small>{detail.source==='manual'?'Marked by you':detail.detectionSource==='yolo'?'YOLO furniture detection':detail.detectionSource==='crack-model'?'Specialist crack candidate':detail.detectionSource==='roomplan'?'Measured in the scan':'Gemini 4 Argon'} · {detail.reviewStatus==='confirmed'?'Confirmed':detail.reviewStatus==='rejected'?'Dismissed':'Needs review'}</small></>:<p>Blue: objects · Red: potential damage. Click a timeline marker or a finding to jump to its exact source frame. Boxes appear only near the assessed timestamp.</p>}</div>
  {error&&<p role="alert" className="notice error-notice">{error}</p>}
 </section>;
}
