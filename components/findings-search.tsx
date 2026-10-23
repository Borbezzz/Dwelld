"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Search, LoaderCircle, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import type { Room, SearchFinding } from "@/lib/types";

export default function FindingsSearch({rooms}: {rooms: Room[]}) {
  const [mode,setMode]=useState("text"); const [indexStatus,setIndexStatus]=useState("");
  const [query,setQuery]=useState(""); const [roomId,setRoomId]=useState("");
  const [results,setResults]=useState<SearchFinding[]>([]); const [busy,setBusy]=useState(false);
  const [error,setError]=useState(""); const [searched,setSearched]=useState(false);
  async function search(event: FormEvent) {
    event.preventDefault(); if(query.trim().length<2 || busy) return;
    setBusy(true);setError("");setSearched(false);setResults([]);
    try { const response=await api.search(query.trim(),roomId,mode);setResults(response.results);setSearched(true); }
    catch(e) {setError(e instanceof Error?e.message:"Search is unavailable. Please try again.");}
    finally {setBusy(false);}
  }
  return <section className="section" aria-labelledby="search-heading"><div className="section-head"><div><p className="eyebrow">FIND THE DETAILS</p><h2 id="search-heading">Search your room records</h2></div></div>
    <form onSubmit={search} style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
      <label style={{flex:"2 1 240px"}}><span className="field-label">Object or damage</span><input className="field" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try desk, scratch, or window" minLength={2} maxLength={200} required disabled={busy}/></label>
      <label style={{flex:"1 1 180px"}}><span className="field-label">Room</span><select className="field" value={roomId} onChange={e=>setRoomId(e.target.value)} disabled={busy}><option value="">All rooms</option>{rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
      <label><span className="field-label">Search method</span><select className="field" value={mode} onChange={e=>setMode(e.target.value)}><option value="text">Keywords</option><option value="semantic">Natural language</option><option value="hybrid">Keywords + meaning</option></select></label>
      <button className="button button-dark" disabled={busy||query.trim().length<2}>{busy?<LoaderCircle className="spin" size={17}/>:<Search size={17}/>} Search</button>
    </form>
    {mode!=="text"&&<div><button className="button" disabled={busy} onClick={async()=>{setBusy(true);setIndexStatus("Preparing your evidence for semantic search…");try{const r=await fetch("/api/search",{method:"POST"});const b=await r.json();if(!r.ok)throw new Error(b.error);setIndexStatus(`${b.indexed} observations ready. ${b.remaining} remaining. Search updates may take a moment.`);}catch(e){setIndexStatus(e instanceof Error?e.message:"Search preparation failed");}finally{setBusy(false);}}}>Prepare search</button><p role="status">{indexStatus}</p></div>}
    <div aria-live="polite">{error&&<p className="notice error-notice" role="alert">{error}</p>}{searched&&<p style={{marginTop:20}}>{results.length?`${results.length} matching findings` : "No matching findings. Try another description or room."}</p>}</div>
    {results.length>0&&<div className="history-list">{results.map(result=><Link className="history-row" key={result.id} href={`/inspections/${result.inspectionId}?finding=${encodeURIComponent(result.id)}`}><span className="history-main"><b>{result.label}</b><small>{rooms.find(room=>room.id===result.roomId)?.name||"Room"} · {result.type}{result.timestamp!=null?` · ${Math.floor(result.timestamp/60)}:${String(Math.floor(result.timestamp%60)).padStart(2,"0")}`:""}</small>{result.description&&<small>{result.description}</small>}</span><ArrowUpRight size={17}/></Link>)}</div>}
  </section>;
}
