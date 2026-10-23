"use client";

import Link from "next/link";
import {authClient} from "@/lib/auth-client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, ArrowRight, LoaderCircle } from "lucide-react";
import FindingsSearch from "./findings-search";
import { api } from "@/lib/api";
import type { Room, Inspection } from "@/lib/types";
import "@/app/landing.css";

export default function Dashboard() {
  const {data:session,isPending:authPending,error:authError}=authClient.useSession();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newRoom, setNewRoom] = useState("");
  const [adding, setAdding] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [r, i] = await Promise.all([api.rooms(), api.inspections()]);
      setRooms(r.rooms); setInspections(i.inspections); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your spaces."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if(session?.user.id)void refresh();else if(!authPending){setLoading(false);setRooms([]);setInspections([]);} }, [session?.user.id,authPending]);
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newRoom.trim() || adding) return;
    setAdding(true);
    try {
      const { room } = await api.createRoom(newRoom.trim());
      setRooms((v) => [room, ...v]); setNewRoom(""); setShowCreate(false); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create room."); }
    finally { setAdding(false); }
  }
  const roomFor = (id: string) => rooms.find((room) => room.id === id);

  return <main className="landing">
    <header className="landing-header">
      <Link href="/" className="landing-wordmark" aria-label="Dwelld home">dwelld.</Link>
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
      <img className="landing-photograph" src="/room-hero.webp" width={1400} height={933} fetchPriority="high" alt="Afternoon sunlight falling through a tall window across a linen bed, oak desk and warm plaster walls"/>
    </section>

    {authError&&<p role="alert">Account access is unavailable. Please retry shortly.</p>}
    {!authPending&&!session&&<p className="landing-empty"><Link href="/sign-in">Sign in or create a profile</Link> to keep your room records private.</p>}
    {error && <div className="landing-error" role="alert"><p>{error}</p><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Retrying…" : "Try again"}</button></div>}

    {session&&<><section id="spaces" className="landing-section" aria-labelledby="spaces-title">
      <div className="landing-section-heading"><h2 id="spaces-title">Your spaces</h2><button className="landing-text-action" type="button" aria-expanded={showCreate} aria-controls="create-room" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Cancel" : "Add a room"}{!showCreate && <span aria-hidden="true">+</span>}</button></div>
      {showCreate && <form className="landing-create" id="create-room" onSubmit={create}>
        <label htmlFor="room-name">Room name<input autoFocus id="room-name" placeholder="e.g. University bedroom" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} maxLength={80} required disabled={adding}/></label>
        <button className="landing-primary" disabled={adding || !newRoom.trim()}>{adding ? "Creating…" : "Create room"}<ArrowRight size={17} aria-hidden="true"/></button>
      </form>}
      {loading ? <p className="landing-loading" role="status"><LoaderCircle className="spin" size={17} aria-hidden="true"/> Loading your spaces…</p> : rooms.length === 0 ? <p className="landing-empty">{error ? "Your spaces could not be loaded." : "Begin with a room. Your walkthroughs and observations will stay together here."}</p> : <div className="landing-room-list">{rooms.map((room, index) => {
        const count = inspections.filter((inspection) => inspection.roomId === room.id).length;
        return <Link className="landing-room" href={`/rooms/${room.id}`} key={room.id}><span className="landing-room-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h3>{room.name}</h3><span className="landing-room-count">{count} {count === 1 ? "inspection" : "inspections"}</span><ArrowUpRight size={20} aria-hidden="true"/></Link>;
      })}</div>}
    </section>

    <section id="history" className="landing-section" aria-labelledby="history-title">
      <div className="landing-section-heading"><h2 id="history-title">Inspection history</h2></div>
      {loading ? <p className="landing-loading" role="status">Loading history…</p> : inspections.length === 0 ? <p className="landing-empty">{error ? "Your history could not be loaded." : "Your saved walkthroughs will appear here."}</p> : <div className="landing-history">{inspections.map((inspection) => <Link key={inspection.id} href={`/inspections/${inspection.id}`} className="landing-history-row"><span className="landing-history-main"><strong>{roomFor(inspection.roomId)?.name || "Room inspection"}</strong><time dateTime={inspection.createdAt}>{new Date(inspection.createdAt).toLocaleDateString(undefined, {day: "numeric", month: "long", year: "numeric"})}</time></span><span className={`landing-status landing-status-${inspection.status}`}>{inspection.status === "completed" ? "Ready to review" : inspection.status.replaceAll("_", " ")}</span><ArrowUpRight size={18} aria-hidden="true"/></Link>)}</div>}
    </section>

    <details className="landing-search"><summary>Find something in your records <span aria-hidden="true">+</span></summary><FindingsSearch rooms={rooms}/></details>
    </>}<footer className="landing-footer"><span className="landing-wordmark">dwelld.</span><p>Your room remembers.</p><a href="#landing-title">Back to top ↑</a></footer>
  </main>;
}
