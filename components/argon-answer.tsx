"use client";

import {useEffect, useState, type ReactNode} from 'react';
import Link from 'next/link';
import {ArrowUpRight} from 'lucide-react';
import './argon-answer.css';

export type ArgonSource = {id:string; label:string; timestamp?:number; findingId?:string; href?:string};

function sourceTime(seconds:number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function SourceChip({source,onSelect}:{source:ArgonSource;onSelect?:(id:string)=>void}) {
  const content = <><span className="argon-source-label">{source.label}</span>{source.timestamp != null && <span className="argon-source-time">{sourceTime(source.timestamp)}</span>}<ArrowUpRight size={12} aria-hidden="true"/></>;
  const title = `View ${source.label}${source.timestamp != null ? ` at ${sourceTime(source.timestamp)}` : ''}`;
  if (source.findingId && onSelect) return <button type="button" className="argon-source" title={title} aria-label={title} onClick={()=>onSelect(source.findingId!)}>{content}</button>;
  if (source.href) return <Link className="argon-source" href={source.href} title={title} aria-label={title}>{content}</Link>;
  return <span className="argon-source argon-source-static">{source.label}{source.timestamp != null && <span className="argon-source-time">{sourceTime(source.timestamp)}</span>}</span>;
}

/** Render a deliberately small text format, with evidence references resolved only from supplied sources. */
export function ArgonAnswer({answer,sources,onSelect}:{answer:string;sources:ArgonSource[];onSelect?:(id:string)=>void}) {
  const referenced = new Set<string>();
  const byId = new Map(sources.map(source=>[source.id,source]));
  function inline(text:string):ReactNode[] {
    return text.split(/(\[(?:[FIS]\d+)(?:\s*,\s*[FIS]\d+)*\]|\*\*[^*]+\*\*)/g).map((part,index)=>{
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2,-2)}</strong>;
      if (!/^\[[FIS]\d+/.test(part)) return part;
      const ids = part.slice(1,-1).split(/\s*,\s*/);
      return <span className="argon-citations" key={index}>{ids.map(id=>{
        const source = byId.get(id);
        if (!source) return <span key={id}>[{id}]</span>;
        referenced.add(id);
        return <SourceChip key={id} source={source} onSelect={onSelect}/>;
      })}</span>;
    });
  }
  const blocks = answer.split(/\n\s*\n/).filter(block=>block.trim()).map((block,index)=>{
    const lines = block.trim().split('\n');
    if (lines.every(line=>/^\s*[-*]\s+/.test(line))) return <ul key={index}>{lines.map((line,i)=><li key={i}>{inline(line.replace(/^\s*[-*]\s+/,''))}</li>)}</ul>;
    return <p key={index}>{inline(block)}</p>;
  });
  const remaining = sources.filter(source=>!referenced.has(source.id));
  return <div className="argon-answer-copy">{blocks}{remaining.length>0 && <div className="argon-related"><span>Related evidence</span><div>{remaining.map(source=><SourceChip key={source.id} source={source} onSelect={onSelect}/>)}</div></div>}</div>;
}

export function ArgonThinking({label='Looking through this scan'}:{label?:string}) {
  const [elapsed,setElapsed] = useState(0);
  useEffect(()=>{
    const start = Date.now();
    const timer = setInterval(()=>setElapsed(Math.floor((Date.now()-start)/1000)),1000);
    return ()=>clearInterval(timer);
  },[]);
  return <div className="argon-thinking" role="status"><span className="argon-thinking-grid" aria-hidden="true">{Array.from({length:9},(_,i)=><span key={i} style={{animationDelay:`${(i%3+Math.abs(Math.floor(i/3)-1))*110}ms`}}/>)}</span><span className="argon-thinking-label">{label}…</span><span className="argon-thinking-time" aria-hidden="true">{elapsed<60?`${elapsed}s`:`${Math.floor(elapsed/60)}m ${elapsed%60}s`}</span></div>;
}
