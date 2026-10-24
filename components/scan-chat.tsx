"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUp,X} from 'lucide-react';
type Answer={answer:string;sources:{id:string;label:string;timestamp?:number;findingId?:string}[];warnings:string[]};
type Turn={question:string;result:Answer};
/** Current-scan Argon context, independent from the historical-record search composer. */
export default function ScanChat({sessionId,inspectionId,token,findingId,onSelect,closed=false}:{sessionId?:string;inspectionId?:string;token?:string;findingId?:string;onSelect?:(id:string)=>void;closed?:boolean}){
 const [question,setQuestion]=useState(''),[turns,setTurns]=useState<Turn[]>([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const job=useRef<AbortController|null>(null),pending=useRef<{question:string;id:string}|null>(null);
 useEffect(()=>()=>job.current?.abort(),[]);
 async function submit(e:FormEvent){e.preventDefault();if(busy||closed||question.trim().length<2)return;
  const text=question.trim(),id=pending.current?.question===text?pending.current.id:crypto.randomUUID();pending.current={question:text,id};
  const controller=new AbortController();job.current=controller;let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},65000);setBusy(true);setOpen(true);setError('');
  try{const r=await fetch('/api/scan-chat',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({sessionId,inspectionId,findingId,question:text,requestId:id})});const b=await r.json();if(!r.ok)throw new Error(b.error||'Argon could not answer.');setTurns(old=>[...old,{question:text,result:b}].slice(-8));setQuestion('');pending.current=null}catch(e){if(timedOut)setError('Argon took too long. Your question is still here; retry shortly.');else if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Chat could not connect.')}finally{clearTimeout(timer);if(job.current===controller)setBusy(false)}
 }
 return <aside className="ask-records scan-chat" aria-label="Chat with Argon about this scan"><div className="ask-anchor">
 {open&&<section className="ask-answer" aria-label="Conversation about the current scan"><header><h2>This scan, with Argon.</h2><button type="button" aria-label="Close scan chat" onClick={()=>setOpen(false)}><X size={16}/></button></header><div className="scan-chat-turns">{turns.map((turn,i)=><div key={i} className="scan-chat-turn"><p className="scan-chat-question">{turn.question}</p><p className="ask-answer-text">{turn.result.answer}</p><div className="ask-sources">{turn.result.sources.map(source=>source.findingId&&onSelect?<button type="button" key={source.id} onClick={()=>onSelect(source.findingId!)}>[{source.id}] {source.label}{source.timestamp!=null?` · ${source.timestamp.toFixed(1)}s`:''}</button>:<span key={source.id}>[{source.id}] {source.label}{source.timestamp!=null?` · ${source.timestamp.toFixed(1)}s`:''}</span>)}</div>{turn.result.warnings.map((w,i)=><small key={i}>{w}</small>)}</div>)}</div>{busy&&<p role="status">Argon is checking this scan’s snapshots and notes…</p>}{error&&<p role="alert">{error}</p>}</section>}
 <form className="ask-composer" onSubmit={e=>void submit(e)}><input aria-label="Ask Argon about this scan" maxLength={1000} placeholder={closed?'Scan saved · continue from its room page':'Ask Argon about this scan or a marked spot…'} disabled={closed} value={question} onChange={e=>setQuestion(e.target.value)}/><span className="ask-model">Argon</span><button className="ask-send" disabled={closed||busy||question.trim().length<2} aria-label="Send question to Argon"><ArrowUp size={18}/></button></form>
 <span className="ask-caption">Current scan · snapshots, findings and your notes</span>
 </div></aside>;
}
