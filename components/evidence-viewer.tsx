"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Maximize2,Minimize2,X} from 'lucide-react';
import WalkthroughPlayer from './walkthrough-player';
import type {Finding} from '@/lib/types';
type Box={x:number;y:number;width:number;height:number};
export type EvidenceItem={id:string;label:string;detail?:string;tone:'check'|'damage'|'object';image?:string;box?:Box|null;point?:{x:number;y:number}|null;timestampSeconds?:number;badge?:string};
const clock=(t?:number)=>t==null?'':`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
/** One review surface: recorded findings seek the original video; LiDAR uses calibrated source photos. */
export default function EvidenceViewer({title,items,videoUrl,onClose}:{title:string;items:EvidenceItem[];videoUrl?:string;onClose:()=>void}){
 const [index,setIndex]=useState(0),[large,setLarge]=useState(false);const root=useRef<HTMLElement>(null);
 useEffect(()=>{root.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});},[]);
 useEffect(()=>{setIndex(0);},[items]);
 const item=items[Math.min(index,items.length-1)];
 const sameFrame=useMemo(()=>item?items.filter(i=>i.image&&i.image===item.image).sort(a=>a.id===item.id?1:-1):[],[items,item]);
 const observations:Finding[]=useMemo(()=>items.map(i=>({id:i.id,label:i.label,description:i.detail,kind:i.tone==='object'?'object':'damage',timestampSeconds:i.timestampSeconds,boundingBox:i.box??undefined,point:i.point??undefined,reviewStatus:i.tone==='damage'?'confirmed':'pending'})),[items]);
 if(!item)return null;
 return <section ref={root} className={`evidence-viewer ${large?'is-large':''}`} aria-label={`Footage of ${title}`}>
  <header><div><b>{title}</b><span>{item.label}{item.timestampSeconds!=null?` · ${clock(item.timestampSeconds)}`:''}</span></div><span className="evidence-tools">{items.length>1&&<><button aria-label="Previous" onClick={()=>setIndex(i=>(i-1+items.length)%items.length)}><ChevronLeft size={15}/></button><small>{index+1}/{items.length}</small><button aria-label="Next" onClick={()=>setIndex(i=>(i+1)%items.length)}><ChevronRight size={15}/></button></>}<button aria-label={large?'Smaller':'Larger'} onClick={()=>setLarge(v=>!v)}>{large?<Minimize2 size={14}/>:<Maximize2 size={14}/>}</button><button aria-label="Close footage" onClick={onClose}><X size={15}/></button></span></header>
  {videoUrl?<WalkthroughPlayer src={videoUrl} findings={observations} selectedId={item.id} onSelect={id=>{const next=items.findIndex(i=>i.id===id);if(next>=0)setIndex(next);}}/>:<><div className="evidence-frame-wrap">{item.image?<div className="evidence-annotated"><img src={`/api/media?url=${encodeURIComponent(item.image)}`} alt={`${item.label} in the analysed frame`}/>{sameFrame.map(i=>i.box?<span key={i.id} className={`evidence-box tone-${i.tone} ${i.id===item.id?'is-current':''}`} style={{left:`${i.box.x*100}%`,top:`${i.box.y*100}%`,width:`${i.box.width*100}%`,height:`${i.box.height*100}%`}}>{i.id===item.id&&<em>{i.label}{i.badge?` · ${i.badge}`:''}</em>}</span>:i.point?<span key={i.id} className={`evidence-pin tone-${i.tone}`} style={{left:`${i.point.x*100}%`,top:`${i.point.y*100}%`}}/>:null)}</div>:<p className="evidence-missing">No saved frame for this observation.</p>}</div>{item.detail&&<footer><p>{item.detail}</p></footer>}</>}
 </section>;
}
