"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import BrandLogo from "./brand-logo";
import ShareSpace from "./share-space";
import type {Room,Inspection,Space} from "@/lib/types";
type Data={space:Space;rooms:Room[]};
export default function SpaceDetail({spaceId}:{spaceId:string}){
 const [data,setData]=useState<Data|null>(null),[scans,setScans]=useState<Inspection[]>([]),[error,setError]=useState(""),[name,setName]=useState(""),[adding,setAdding]=useState(false),[sharing,setSharing]=useState(false);
 const load=useCallback(async()=>{const [r,i]=await Promise.all([fetch(`/api/spaces/${spaceId}`),fetch("/api/inspections")]);const [b,h]=await Promise.all([r.json(),i.json()]);if(!r.ok)throw new Error(b.error||"Space unavailable");if(!i.ok)throw new Error(h.error||"Could not load inspections");setData(b);setScans(h.inspections||[]);},[spaceId]);
 useEffect(()=>{void load().catch(e=>setError(e.message))},[load]);
 async function create(e:React.FormEvent){e.preventDefault();setAdding(true);setError("");try{const r=await fetch("/api/rooms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,spaceId})});const b=await r.json();if(!r.ok)throw new Error(b.error);setName("");await load();}catch(e){setError(e instanceof Error?e.message:"Could not create room");}finally{setAdding(false)}}
 return <main className="landing"><header className="landing-header"><BrandLogo linked/><nav><Link href="/">All spaces</Link></nav></header><div className="landing-intro" style={{display:"block"}}><p className="eyebrow">A SHARED PROPERTY</p><h1>{data?.space.name||"Your space."}</h1><p className="lead">Keep each room, its move-in and move-out scans, and supporting evidence in one place.</p>{data?.space.role==="owner"&&<button className="landing-text-action" type="button" onClick={()=>setSharing(!sharing)}>{sharing?"Close sharing":"Share this space ↗"}</button>}{sharing&&data?.space.role==="owner"&&<ShareSpace spaceId={spaceId}/>}</div>{error&&<p role="alert">{error}</p>}
 <section className="landing-section"><div className="landing-section-heading"><h2>Rooms</h2><span>{data?.rooms.length||0} rooms</span></div>
 {data?.space&&<form className="space-create" onSubmit={e=>void create(e)}><label htmlFor="room-name">Add a room</label><input id="room-name" placeholder="Bedroom, kitchen, living room…" maxLength={80} required value={name} onChange={e=>setName(e.target.value)}/><button className="landing-primary" disabled={adding||!name.trim()}>{adding?"Adding…":"Add room"}</button></form>}
 {data?.rooms.map(room=>{const history=scans.filter(i=>i.roomId===room.id),ready=history.filter(i=>i.status==="completed"||i.status==="partial");return <article key={room.id} className="space-room-card"><div><h3><Link href={`/rooms/${room.id}`}>{room.name} ↗</Link></h3><p>{history.length} inspections</p></div><div className="space-room-actions"><Link href={`/live?room=${room.id}&type=move-in`}>Check in scan</Link><Link href={`/live?room=${room.id}&type=move-out`}>Check out scan</Link>{ready.length>=2&&<Link href={`/rooms/${room.id}/compare`}>Compare ↗</Link>}</div><ul>{history.slice(0,3).map(i=><li key={`${i.id}-${i.roomId}`}><Link href={i.virtual?`/rooms/${room.id}`:`/inspections/${i.id}`}>{i.type==="move-out"?"Check out":"Check in"} · {new Date(i.createdAt).toLocaleDateString()} · {i.status}</Link></li>)}</ul></article>})}
 {data&&data.rooms.length===0&&<p className="landing-empty">Start by adding your first room.</p>}
 </section><footer className="landing-footer"><BrandLogo compact/><p>Your room remembers.</p></footer></main>;
}
