'use client';
import {useEffect,useState} from 'react';
import type {LiveFinding} from '@/lib/live/types';
import {timelineGroups} from '@/lib/inspection-timeline';
const clock=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
/** The same camera surface shows exact assessed photos; delayed boxes never float over newer footage. */
export default function LiveDamagePreview({sessionId,token,findings,preview,selectedId,onSelect}:{sessionId:string;token:string;findings:LiveFinding[];preview?:string;selectedId?:string|null;onSelect:(id:string)=>void}){
 const visible=findings.filter(f=>f.reviewStatus!=='rejected'&&(f.evidenceFrameRef||f.evidenceFrameUrl));
 const latest=visible.reduce<LiveFinding|undefined>((last,f)=>!last||(f.timestampSeconds??0)>=(last.timestampSeconds??0)?f:last,undefined);
 const selected=visible.find(f=>f.id===selectedId)||latest,ref=selected?.evidenceFrameRef||selected?.evidenceFrameUrl;
 const [photo,setPhoto]=useState<{ref:string;url:string}|null>(null),[live,setLive]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{if(selectedId)setLive(false);},[selectedId]);
 useEffect(()=>{if(!ref||!token)return;const controller=new AbortController();let url='';setMessage('');
  void fetch(`/api/live/${sessionId}/media?ref=${encodeURIComponent(ref)}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('The source photo could not load. Live preview is still available.');return r.blob();}).then(blob=>{if(!controller.signal.aborted){url=URL.createObjectURL(blob);setPhoto({ref,url});}}).catch(e=>{if(!controller.signal.aborted)setMessage(e.message);});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[sessionId,token,ref]);
 const source=!live&&!!ref,marks=source?visible.filter(f=>(f.evidenceFrameRef||f.evidenceFrameUrl)===ref):[];
 const groups=timelineGroups(visible);
 return <section className="live-evidence-player" aria-label="Live camera and marked source evidence"><header><b>{source?`Analysed source · ${clock(selected?.timestampSeconds??0)}`:'Live from your phone'}</b>{ref&&<button type="button" className="text-button" onClick={()=>setLive(v=>!v)}>{live?'Show marked evidence':'Return to live camera'}</button>}</header><div className="live-evidence-stage">{source?(photo?.ref===ref?<img src={photo.url} alt="Exact source photo with automatically located findings"/>:<p role="status">Loading marked source photo…</p>):preview?<img src={preview} alt="Latest camera frame from your phone"/>:<p>Camera view appears when scanning starts.</p>}{photo?.ref===ref&&marks.map(f=>f.boundingBox?<button type="button" key={f.id} className={`walkthrough-mark is-damage ${f.id===selected?.id?'is-selected':''}`} aria-label={`Damage: ${f.label}`} title={f.description||f.label} style={{left:`${f.boundingBox.x*100}%`,top:`${f.boundingBox.y*100}%`,width:`${f.boundingBox.width*100}%`,height:`${f.boundingBox.height*100}%`}} onClick={()=>onSelect(f.id)}><span>{f.label}</span></button>:null)}</div>
 {groups.length>0&&<nav aria-label="Source photo timeline">{groups.map(g=><button type="button" key={g.time} className="button button-outline" aria-current={selected&&Math.abs((selected.timestampSeconds??0)-g.time)<.01?'true':undefined} onClick={()=>{setLive(false);onSelect(g.items[0].id);}}>{clock(g.time)} · {g.items.length}</button>)}</nav>}
 <p className="live-evidence-caption">{source?(selected?.description||'Automatically marked candidate. Hover the box to inspect it, then confirm or dismiss it.'):'The camera continues live. Analysis marks appear on their exact source photo when ready.'}</p>{message&&<p role="status">{message}</p>}</section>;
}
