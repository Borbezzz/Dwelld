"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {authClient} from "@/lib/auth-client";
import {api} from "@/lib/api";
import type {Room} from "@/lib/types";
import EditorialShell from "@/components/editorial-shell";
import SearchLab from "@/components/search-lab";
export default function SearchPage(){
 const {data:session,isPending}=authClient.useSession();const [rooms,setRooms]=useState<Room[]>([]);
 useEffect(()=>{if(session)api.rooms().then(r=>setRooms(r.rooms)).catch(()=>setRooms([]));},[session]);
 return <EditorialShell>{isPending?<p className="lab-muted" style={{padding:40}}>Loading…</p>:!session?<section className="search-lab"><h1>Sign in to search your records.</h1><Link className="button button-dark" href="/sign-in">Sign in</Link></section>:<SearchLab rooms={rooms}/>}</EditorialShell>;
}
