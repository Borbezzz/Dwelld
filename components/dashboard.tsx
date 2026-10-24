"use client";

import Link from "next/link";
import BrandLogo from "./brand-logo";
import ShareSpace from "./share-space";
import {authClient} from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Trash2 } from "lucide-react";
import RoomReconstruction from "./room-reconstruction";
import FindingsSearch from "./findings-search";
import { api } from "@/lib/api";
import type { Room, Space, Inspection } from "@/lib/types";
import "@/app/landing.css";

export default function Dashboard() {
  const {data:session,isPending:authPending,error:authError}=authClient.useSession();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [spaces,setSpaces]=useState<Space[]>([]),[newSpace,setNewSpace]=useState(""),[spaceBusy,setSpaceBusy]=useState(false),[sharing,setSharing]=useState("");
  const [confirmDelete, setConfirmDelete] = useState(""), [deleting, setDeleting] = useState(false);
  async function deleteRoom(id: string) {
    setDeleting(true); setError("");
    try { const r = await fetch(`/api/rooms/${id}`, { method: "DELETE" }); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || "Could not delete the room."); setConfirmDelete(""); if (selectedRoom === id) setSelectedRoom(""); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not delete the room."); } finally { setDeleting(false); }
  }
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRoom,setSelectedRoom]=useState("");

  async function refresh() {
    setLoading(true);
    try {
      const [r, i, s] = await Promise.all([api.rooms(), api.inspections(), api.spaces()]);
      setRooms(r.rooms); setInspections(i.inspections);setSpaces(s.spaces); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your spaces."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if(session?.user.id)void refresh();else if(!authPending){setLoading(false);setRooms([]);setInspections([]);setSpaces([]);} }, [session?.user.id,authPending]);
  const roomFor = (id: string) => rooms.find((room) => room.id === id);
  async function createSpace(e: React.FormEvent) { e.preventDefault();if(!newSpace.trim())return;setSpaceBusy(true);try{await api.createSpace(newSpace.trim());setNewSpace("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Couldn't create this space.");}finally{setSpaceBusy(false);} }
  async function moveRoom(id:string,spaceId:string|null){setSpaceBusy(true);try{await api.assignRoomToSpace(id,spaceId);await refresh();}catch(e){setError(e instanceof Error?e.message:"Couldn't move this room.");}finally{setSpaceBusy(false);} }


  return <main className={`landing ${session?"landing-account":""}`}>
    <header className="landing-header">
      <BrandLogo linked />
      <nav aria-label="Main navigation"><a href="#spaces">Your spaces</a><a href="#history">History</a><Link href={session?"/profile":"/sign-in"}>{session?"Profile":"Sign in"}</Link></nav>
    </header>

    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-intro">
        <h1 id="landing-title">Your room.<br/><em>On record.</em></h1>
        <div className="landing-intro-copy">
          <p>A place to keep the details.<br/>Document your room, review what you find,<br className="landing-desktop-break"/> and keep a record you can return to.</p>
          <Link className="landing-primary" href={session?"/live":"/sign-in"}>Start an inspection <ArrowUpRight size={19} aria-hidden="true"/></Link>
        </div>
      </div>
      {!session&&<img className="landing-photograph" src="/room-hero.webp" width={1400} height={933} fetchPriority="high" alt="Afternoon sunlight falling through a tall window across a linen bed, oak desk and warm plaster walls"/>}
    </section>

    {authError&&<p role="alert">Account access is unavailable. Please retry shortly.</p>}
    {!authPending&&!session&&<p className="landing-empty"><Link href="/sign-in">Sign in or create a profile</Link> to keep your room records private.</p>}
    {error && <div className="landing-error" role="alert"><p>{error}</p><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Retrying…" : "Try again"}</button></div>}

    {session&&<><section id="spaces" className="landing-section" aria-labelledby="spaces-title">
      <div className="landing-section-heading"><h2 id="spaces-title">Your spaces</h2><Link className="landing-text-action" href="/live?new=1">Add a room <span aria-hidden="true">+</span></Link></div>
      <form onSubmit={e=>void createSpace(e)} className="space-create"><label htmlFor="new-space">Group rooms into a property</label><input id="new-space" aria-label="New space name" placeholder="e.g. Flat 12" maxLength={80} value={newSpace} onChange={e=>setNewSpace(e.target.value)}/><button className="landing-primary" disabled={spaceBusy||!newSpace.trim()}>Create space</button></form>
      {spaces.length>0&&<div className="space-groups">{spaces.map(s=><div className="space-group" key={s.id}><h3><Link href={`/spaces/${s.id}`}>{s.name} ↗</Link></h3><span>{rooms.filter(r=>r.spaceId===s.id).length} rooms</span>{s.role==="owner"&&<button type="button" onClick={()=>setSharing(sharing===s.id?"":s.id)}>Share</button>}{sharing===s.id&&s.role==="owner"&&<ShareSpace spaceId={s.id}/>}</div>)}</div>}
      <div className="spaces-split"><div>
      {loading ? <div className="landing-room-list" role="status" aria-label="Loading your spaces">{[0,1,2].map(i=><div className="landing-room landing-room-skeleton" key={i} aria-hidden="true"><span className="skeleton" style={{width:18,height:12}}/><span className="skeleton" style={{width:`${[62,48,55][i]}%`,height:26}}/><span className="skeleton" style={{width:74,height:12}}/><span className="skeleton" style={{width:18,height:18}}/></div>)}</div> : rooms.length === 0 ? <p className="landing-empty">{error ? "Your spaces could not be loaded." : "Begin with a room. Your walkthroughs and observations will stay together here."}</p> : <div className="landing-room-list">{rooms.map((room, index) => {
        const count = inspections.filter((inspection) => inspection.roomId === room.id).length;
        const active=room.id===(selectedRoom||rooms[0]?.id);
        return <div className={`landing-room ${active?"active":""}`} key={room.id} onClick={e=>{if(!(e.target as HTMLElement).closest("a,.room-delete,.room-delete-confirm"))setSelectedRoom(room.id);}}><span className="landing-room-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h3><button className="room-select" aria-pressed={active} aria-label={`Show ${room.name} in 3D`} onClick={()=>setSelectedRoom(room.id)}>{room.name}</button></h3><span className="landing-room-count">{active&&rooms.length>1?<span className="room-shown">Previewing · </span>:null}{count} {count === 1 ? "inspection" : "inspections"}</span><span className="room-row-actions">{room.isOwner!==false&&<select className="room-space-select" aria-label={`Property for ${room.name}`} value={room.spaceId||""} disabled={spaceBusy} onClick={e=>e.stopPropagation()} onChange={e=>void moveRoom(room.id,e.target.value||null)}><option value="">Ungrouped</option>{spaces.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select>}{room.isOwner!==false&&<button type="button" className="room-delete" aria-label={`Delete ${room.name}`} title="Delete room" onClick={()=>setConfirmDelete(room.id)}><Trash2 size={16} aria-hidden="true"/></button>}<Link href={`/rooms/${room.id}`} aria-label={`Open ${room.name}`}><ArrowUpRight size={20} aria-hidden="true"/></Link></span>{confirmDelete===room.id&&<div className="room-delete-confirm" role="group" aria-label={`Delete ${room.name}?`}><p>Delete {room.name} and its {count} {count===1?"scan":"scans"}? This can't be undone.</p><button className="button-danger" disabled={deleting} onClick={()=>void deleteRoom(room.id)}>{deleting?"Deleting…":"Delete room"}</button><button className="text-button" disabled={deleting} onClick={()=>setConfirmDelete("")}>Keep it</button></div>}</div>;
      })}</div>}</div><RoomReconstruction loading={loading} roomId={selectedRoom||rooms[0]?.id||""} name={roomFor(selectedRoom||rooms[0]?.id)?.name||""} inspections={inspections} hint={rooms.length>1}/></div>
    </section>

    <section id="history" className="landing-section" aria-labelledby="history-title">
      <div className="landing-section-heading"><h2 id="history-title">Inspection history</h2></div>
      {loading ? <div className="landing-history" role="status" aria-label="Loading history">{[0,1].map(i=><div className="landing-history-row" key={i} aria-hidden="true"><span className="landing-history-main"><span className="skeleton" style={{width:160,height:16}}/><span className="skeleton" style={{width:110,height:12,marginTop:8}}/></span><span className="skeleton" style={{width:90,height:12}}/><span/></div>)}</div> : inspections.length === 0 ? <p className="landing-empty">{error ? "Your history could not be loaded." : "Your saved walkthroughs will appear here."}</p> : <div className="landing-history">{inspections.map((inspection) => <Link key={inspection.id} href={`/inspections/${inspection.id}`} className="landing-history-row"><span className="landing-history-main"><strong>{roomFor(inspection.roomId)?.name || "Room inspection"}</strong><time dateTime={inspection.createdAt}>{new Date(inspection.createdAt).toLocaleDateString(undefined, {day: "numeric", month: "long", year: "numeric"})}</time></span><span className={`landing-status landing-status-${inspection.status}`}>{inspection.status === "completed" ? "Ready to review" : inspection.status.replaceAll("_", " ")}</span><ArrowUpRight size={18} aria-hidden="true"/></Link>)}</div>}
    </section>

    <details className="landing-search"><summary>Find something in your records <span aria-hidden="true">+</span></summary><FindingsSearch rooms={rooms}/><p style={{marginTop:12}}><Link className="landing-text-action" href="/search">Open the search lab: see how Atlas ranks keywords, meaning and photos →</Link></p></details>
    </>}<footer className="landing-footer"><BrandLogo compact /><p>Your room remembers.</p><a href="#landing-title">Back to top ↑</a></footer>
  </main>;
}
