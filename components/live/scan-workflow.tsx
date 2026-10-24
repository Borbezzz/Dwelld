"use client";
import {useState} from 'react';
import {Check,ChevronDown,CircleAlert,LoaderCircle,Minus} from 'lucide-react';
import {scanWorkflow} from '@/lib/live/workflow';
import type {InspectionSession} from '@/lib/live/types';
export default function ScanWorkflow({session}:{session:InspectionSession}){
 const [opened,setOpened]=useState<Record<string,boolean>>({});
 const rows=scanWorkflow(session),active=rows.find(row=>row.status==='running'||row.status==='partial'||row.status==='failed')?.key;
 return <section className="scan-workflow" aria-label="Scan workflow"><header><p className="eyebrow">YOUR SCAN, STEP BY STEP</p><h3>From capture to room record</h3></header><ol>{rows.map((row,index)=>{const open=opened[row.key]??row.key===active;const Icon=row.status==='done'?Check:row.status==='failed'||row.status==='partial'?CircleAlert:row.status==='running'?LoaderCircle:Minus;return <li key={row.key} className={`workflow-${row.status}`} style={{animationDelay:`${index*70}ms`}}><button type="button" aria-expanded={open} aria-controls={`workflow-${row.key}`} onClick={()=>setOpened(previous=>({...previous,[row.key]:!open}))}><span className="workflow-ring"><Icon size={15} className={row.status==='running'?'spin':undefined}/></span><b>{row.label}</b><span className="workflow-amount">{row.amount}</span><span className="workflow-badge">{row.status==='done'?'Completed':row.status==='failed'?'Needs retry':row.status==='partial'?'Incomplete':row.status==='running'?'In progress':'Waiting'}</span><ChevronDown size={14} style={{transform:open?'rotate(180deg)':undefined}}/></button><div className="workflow-expand" style={{gridTemplateRows:open?'1fr':'0fr'}}><div><dl id={`workflow-${row.key}`} aria-hidden={!open}>{row.details.map(detail=><div key={detail.label}><dt>{detail.label}</dt><dd>{detail.meta}</dd></div>)}</dl></div></div></li>;})}</ol></section>;
}
