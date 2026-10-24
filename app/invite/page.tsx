"use client";
import {useSearchParams} from "next/navigation";
import {Suspense,useState} from "react";
import Link from "next/link";
function Accept(){const params=useSearchParams(),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);const token=params.get("token")||"";
async function accept(){setBusy(true);try{const r=await fetch("/api/invites/accept",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});const b=await r.json();if(!r.ok)throw new Error(b.error||"Could not accept invitation");setMessage(`Joined ${b.name}. Your account is now a member of this space.`);}catch(e){setMessage(e instanceof Error?e.message:"Could not accept invitation");}finally{setBusy(false);}}
return <main className="editorial-surface"><h1>Join a shared space.</h1><p>Sign in using the exact email your invitation was sent to. Invite links expire after seven days and work once.</p>{token?<button className="button button-dark" disabled={busy} onClick={()=>void accept()}>{busy?"Joining…":"Accept invitation"}</button>:<p>Missing invitation token.</p>}{message&&<p role="status">{message}</p>}<p><Link href="/sign-in">Sign in</Link> · <Link href="/">Dashboard</Link></p></main>}
export default function Page(){return <Suspense fallback={<main>Loading invitation…</main>}><Accept/></Suspense>}
