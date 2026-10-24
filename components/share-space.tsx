"use client";
import {useCallback,useEffect,useId,useState} from "react";
import {Check,Copy,Link2,UserPlus} from "lucide-react";
type Member={id:string;email:string;role:string};
type Invite={id:string;email:string;role:string;expiresAt:string};
export default function ShareSpace({spaceId}:{spaceId:string}){
 const fieldId=useId();
 const [email,setEmail]=useState(""),[role,setRole]=useState<"tenant"|"landlord">("landlord"),[link,setLink]=useState(""),[copied,setCopied]=useState(false),[error,setError]=useState(""),[members,setMembers]=useState<Member[]>([]),[invites,setInvites]=useState<Invite[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  const r=await fetch(`/api/spaces/${spaceId}/invites`,{signal});
  const b=await r.json();if(!r.ok)throw new Error(b.error||"Could not load sharing details.");
  setMembers(b.members);setInvites(b.invites);
 },[spaceId]);
 useEffect(()=>{const controller=new AbortController();setLoading(true);void refresh(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[refresh]);
 async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");setLink("");setCopied(false);try{const r=await fetch(`/api/spaces/${spaceId}/invites`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,role})});const b=await r.json();if(!r.ok)throw new Error(b.error||"Could not create invitation.");setLink(b.url);setEmail("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Could not invite");}finally{setBusy(false);}}
 async function copy(){try{await navigator.clipboard.writeText(link);setCopied(true)}catch{setError("Could not copy the link. Select it and copy manually.")}}
 async function remove(kind:"members"|"invites",id:string){setError("");try{const r=await fetch(`/api/spaces/${spaceId}/${kind}/${id}`,{method:"DELETE"});if(!r.ok)throw new Error(kind==="members"?"Could not remove member":"Could not revoke invitation");await refresh()}catch(e){setError(e instanceof Error?e.message:"Could not update sharing")}}
 return <section className="space-sharing" aria-label="Property sharing">
  <div className="space-sharing-heading"><span className="space-sharing-symbol" aria-hidden="true"><UserPlus size={20}/></span><div><h4>Share your property</h4><p>Invite a landlord or tenant to view the rooms and their records.</p></div></div>
  <form className="space-invite-form" onSubmit={e=>void create(e)}>
   <label className="space-email-field" htmlFor={`${fieldId}-email`}>Email address<input id={`${fieldId}-email`} type="email" required maxLength={254} placeholder="name@example.com" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label htmlFor={`${fieldId}-role`}>Invite as<select id={`${fieldId}-role`} value={role} onChange={e=>setRole(e.target.value as "tenant"|"landlord")}><option value="landlord">Landlord</option><option value="tenant">Tenant</option></select></label>
   <button className="landing-primary" disabled={busy}>{busy?"Creating…":"Create invite"}<UserPlus size={16} aria-hidden="true"/></button>
  </form>
  <p className="space-sharing-note">Invites last seven days. The recipient signs in with this email.</p>
  {error&&<p className="space-sharing-error" role="alert">{error}</p>}
  {link&&<div className="space-invite-link"><label htmlFor={`${fieldId}-link`}><Link2 size={15} aria-hidden="true"/>Invitation ready · share this one-use link</label><div><input id={`${fieldId}-link`} readOnly value={link} onFocus={e=>e.target.select()}/><button className="space-action" type="button" aria-label={copied?"Invitation link copied":"Copy invitation link"} onClick={()=>void copy()}>{copied?<Check size={15} aria-hidden="true"/>:<Copy size={15} aria-hidden="true"/>}<span role="status">{copied?"Copied":"Copy link"}</span></button></div></div>}
  <div className="space-access"><h5>People with access <span>{members.length}</span></h5>{loading?<p role="status">Loading sharing details…</p>:members.length===0?<p>No accepted invitations yet.</p>:<ul>{members.map(m=><li key={m.id}><div><b>{m.email}</b><span>{m.role}</span></div><button className="space-access-action" type="button" onClick={()=>{if(confirm(`Remove access for ${m.email}?`))void remove("members",m.id)}}>Remove access</button></li>)}</ul>}
  {invites.length>0&&<><h5>Pending invitations <span>{invites.length}</span></h5><ul>{invites.map(i=><li key={i.id}><div><b>{i.email}</b><span>{i.role} · Expires {new Date(i.expiresAt).toLocaleDateString()}</span></div><button className="space-access-action" type="button" onClick={()=>void remove("invites",i.id)}>Revoke invite</button></li>)}</ul></>}
  </div>
 </section>;
}
