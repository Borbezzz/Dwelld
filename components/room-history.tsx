"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import type {Inspection} from "@/lib/types";
export default function RoomHistory({roomId}:{roomId:string}){const [items,setItems]=useState<Inspection[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 useEffect(()=>{const abort=new AbortController();fetch(`/api/inspections?roomId=${roomId}`,{signal:abort.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||"Could not load room history");return body;}).then(b=>setItems(b.inspections)).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[roomId]);
 return <section style={{borderTop:"1px solid #c9cec7",marginTop:40,paddingTop:24}}><h2>Room history</h2>{loading?<p>Loading inspections…</p>:error?<p role="alert">{error}</p>:!items.length?<p>Your completed scans will be kept here.</p>:<ol style={{listStyle:"none",padding:0}}>{items.map(i=><li key={i.id} style={{padding:"16px 0",borderBottom:"1px solid #d9ddd6",display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}><Link href={`/inspections/${i.id}`}>{i.type||"Inspection"} · {new Date(i.createdAt).toLocaleString()}</Link><span>{i.status}</span>{["completed","partial"].includes(i.status)&&<><Link href={`/inspections/${i.id}/report`}>Report</Link><Link href={`/inspections/${i.id}/spatial`}>Spatial record</Link></>}</li>)}</ol>}<Link href={`/rooms/${roomId}/compare`}>Compare move-in and move-out evidence →</Link></section>;
}
