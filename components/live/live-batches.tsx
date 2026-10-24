"use client";
import {useEffect,useState} from 'react';
import {Check,CheckCheck,CircleAlert,Clock3,LoaderCircle,RefreshCw,ScanLine} from 'lucide-react';
import type {LiveBatch} from '@/lib/live/types';
import ObjectIcon from './object-icon';
import {batchLanes} from '@/lib/live/batches';
const stamp=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function BatchCard({batch,slot,sessionId,token,settled}:{batch?:LiveBatch;slot:number;sessionId:string;token:string;settled:boolean}){
 const [image,setImage]=useState<{ref:string;url:string;ratio:number}|null>(null),[imageError,setImageError]=useState(false);
 const ref=batch?.evidenceRef;
 useEffect(()=>{if(!ref||!token)return;const controller=new AbortController();let url='';setImageError(false);
  void fetch(`/api/live/${sessionId}/media?ref=${encodeURIComponent(ref)}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then(async response=>{if(!response.ok)throw Error('Source image unavailable');return response.blob();}).then(blob=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setImage({ref,url,ratio:4/3});}).catch(()=>{if(!controller.signal.aborted)setImageError(true);});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[ref,sessionId,token]);
 const status=batch?.status||(settled?'idle':'waiting'),active=status==='checking'||status==='retrying',clean=status==='clear',failed=status==='failed'||status==='unassessed';
 const Icon=clean?CheckCheck:failed?CircleAlert:status==='findings'?ScanLine:active?LoaderCircle:status==='idle'?Check:Clock3;
 const title=clean?'No visible damage returned':status==='findings'?`${batch!.findingCount} potential ${batch!.findingCount===1?'finding':'findings'}`:status==='retrying'?`Retry ${batch!.attempt} of 3`:status==='checking'?'Argon is checking':failed?'Unassessed · needs retry':status==='queued'?'Source saved · queued':status==='idle'?'No remaining work':'Waiting for source frames';
 return <article className={`batch-card batch-${status}`} aria-label={`Processing lane ${slot+1}`}>
  <header><span>Lane {slot+1}</span><Icon size={14} className={active?'spin':undefined}/></header>
  <div className="batch-image" style={{aspectRatio:image&&image.ref===ref?image.ratio:4/3}} key={batch?.id||'empty'}>
   {ref&&image?.ref===ref?<img className={clean?'batch-dissolve':''} src={image?.url} onLoad={event=>{const ratio=event.currentTarget.naturalWidth/event.currentTarget.naturalHeight;setImage(previous=>previous&&previous.ref===ref?{...previous,ratio}:previous);}} alt={`Saved source frame at ${stamp(batch?.timestampSeconds||0)}`}/>:<div className="batch-placeholder"><ScanLine size={24}/><span>{imageError?'Source image could not load':batch?'Loading source photo':settled?'Lane complete':'Awaiting capture'}</span></div>}
   {batch&&image?.ref===ref&&<><div className="batch-annotations">{batch.objects.map(object=><span key={object.id} className="batch-object-box" style={{left:`${object.boundingBox.x*100}%`,top:`${object.boundingBox.y*100}%`,width:`${object.boundingBox.width*100}%`,height:`${object.boundingBox.height*100}%`}}><b><ObjectIcon label={object.label} size={10}/>{object.label}</b></span>)}{batch.observations.map((finding,index)=>{const box=finding.boundingBox;return box?<span key={index} className="batch-damage-box" style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`}} title={finding.description}><b>{finding.label}</b></span>:null;})}</div>{active&&<div className="batch-scanner"/>}{clean&&<div className="batch-clear-check"><Check size={25}/></div>}</>}
  </div>
  <div className="batch-result" role="status"><b>{title}</b>{batch&&<small>{stamp(batch.startSeconds)}–{stamp(batch.endSeconds)} · {batch.checked}/{batch.frames} frames checked</small>}{batch?.message&&<p>{batch.message}</p>}{clean&&<small>Visible furniture in these source views only.</small>}{batch?.objects.length?<ul className="batch-object-list">{batch.objects.map(object=><li key={object.id}><ObjectIcon label={object.label} size={12}/>{object.label}<Check size={11}/></li>)}</ul>:null}</div>
 </article>;
}
export default function LiveBatches({batches,sessionId,token,onRetry,closed=false}:{batches:LiveBatch[];sessionId:string;token:string;onRetry:()=>Promise<void>;closed?:boolean}){
 const [retrying,setRetrying]=useState(false),[error,setError]=useState('');
 const lanes=batchLanes(batches),settled=closed&&!batches.some(b=>['checking','retrying','queued'].includes(b.status));
 return <section className="live-batches" aria-label="Parallel source frame processing"><header><div><p className="eyebrow">SOURCE FRAME PROCESSING</p><h3>Four checks in parallel</h3></div>{!closed&&batches.some(b=>b.status==='failed')&&<button className="button button-outline" disabled={retrying} onClick={()=>{setRetrying(true);setError('');void onRetry().catch(e=>setError(e instanceof Error?e.message:'Retry could not start')).finally(()=>setRetrying(false));}}><RefreshCw size={14}/>{retrying?'Starting retry…':'Retry unassessed frames'}</button>}</header><div className="batch-grid">{lanes.map((batch,slot)=><BatchCard key={slot} batch={batch} slot={slot} sessionId={sessionId} token={token} settled={settled}/>)}</div><p className="batch-scope">Cards show saved source photos, so boxes stay attached to the pixels Argon checked. A clear card applies only to those views.</p>{error&&<p role="alert">{error}</p>}</section>;
}
