"use client";
import {useEffect,useRef,useState} from 'react';
import {api} from '@/lib/api';
import {detectVideoFrames} from '@/lib/client/video-detection';
import {MAX_VIDEO_BYTES,uploadVideo} from '@/lib/client/upload-video';
export default function InspectionUpload({roomId,roomName,type,onBusy}:{roomId:string;roomName:string;type:'move-in'|'move-out';onBusy:(busy:boolean)=>void}){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
 const job=useRef<AbortController|null>(null),createdRoom=useRef('');
 useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
 useEffect(()=>()=>job.current?.abort(),[]);
 useEffect(()=>{createdRoom.current='';},[roomId,roomName]);
 async function submit(){if(!file||job.current)return;const controller=new AbortController();job.current=controller;setBusy(true);onBusy(true);setError('');try{
 const frames=await detectVideoFrames(file,setProgress,controller.signal);controller.signal.throwIfAborted();
 const asset=await uploadVideo(file,{signal:controller.signal,onProgress:n=>setProgress(`Uploading walkthrough · ${n}%`)});controller.signal.throwIfAborted();
 const target=roomId||createdRoom.current||(await api.createRoom(roomName.trim()||'My room')).room.id;createdRoom.current=target;
 setProgress('Preparing your inspection…');const {inspection}=await api.createInspection(target,asset.url,asset.contentType,frames,type);window.location.assign(`/inspections/${inspection.id}`);
 }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Upload failed. Please retry.');}finally{job.current=null;if(!controller.signal.aborted){setBusy(false);onBusy(false);}}}
 return <div className="inspection-upload">{preview&&<video src={preview} controls playsInline aria-label="Walkthrough preview"/>}<label className="upload-picker">{file?file.name:'Choose a recorded walkthrough'}<input disabled={busy} type="file" accept="video/*,.mp4,.mov,.webm" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(!f.size||f.size>MAX_VIDEO_BYTES||(!f.type.startsWith('video/')&&!/\.(mp4|mov|webm)$/i.test(f.name))){setError('Choose an MP4, MOV or WebM video under 100 MB.');return;}const type=f.type.startsWith('video/')?f.type:/\.mov$/i.test(f.name)?'video/quicktime':/\.webm$/i.test(f.name)?'video/webm':'video/mp4';setFile(f.type===type?f:new File([f],f.name,{type}));setError('');}}/></label><p>MP4, MOV or WebM · up to 2 minutes · 100 MB. The video codec must be playable in this browser.</p>{file&&<button className="landing-primary" disabled={busy} onClick={()=>void submit()}>{busy?'Preparing your record…':'Analyse walkthrough ↗'}</button>}{progress&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}</div>
}
