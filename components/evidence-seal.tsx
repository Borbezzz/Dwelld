'use client';
import {useEffect,useState} from 'react';
type Seal={seq:number;sealedAt:string;seal:string;prevSeal:string;signature:string;keyId:string;filesRoot:string;fileCount:number;problems:string[]};
type Check={sealed:boolean;intact:boolean;entries:Seal[];changedFiles:{name:string;kind:string;problem:string}[];chain:{length:number;intact:boolean;problems:{seq:number;problem:string}[]};publicKey:string;keyId:string;checkedAt:string};
const short=(h:string)=>`${h.slice(0,12)}…${h.slice(-8)}`;
/** Shows the inspection's seal and re-checks it: every file re-hashed, the signature and the chain around it. */
export default function EvidenceSeal({inspectionId}:{inspectionId:string}){
 const [check,setCheck]=useState<Check|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(method:'GET'|'POST'='GET'){setBusy(true);setError('');try{const r=await fetch(`/api/inspections/${inspectionId}/seal`,{method}),b=await r.json();if(!r.ok)throw new Error(b.error||'Seal check failed');setCheck(b);}catch(e){setError(e instanceof Error?e.message:'Seal check failed');}finally{setBusy(false);}}
 useEffect(()=>{void load();// eslint-disable-next-line react-hooks/exhaustive-deps
 },[inspectionId]);
 const latest=check?.entries.at(-1);
 return <section className="evidence-seal" aria-labelledby="seal-title"><style>{`
 .evidence-seal{border:1px solid #c8d0c0;padding:18px 20px;margin-top:36px;break-inside:avoid}.evidence-seal h2{margin:0 0 6px!important}.seal-state{display:inline-block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;margin-bottom:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.seal-ok{background:#dfeadb;color:#2f5a35}.seal-bad{background:#f4dcd6;color:#8a2f22}.seal-none{background:#efece3;color:#6b6250}.evidence-seal dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:13px;margin:12px 0}.evidence-seal dt{color:#687462}.evidence-seal dd{margin:0;font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}.evidence-seal p{font-size:13px;line-height:1.6}.seal-actions{display:flex;gap:12px;align-items:center}@media print{.seal-actions{display:none}}
 `}</style>
 <h2 id="seal-title">Evidence seal</h2>
 {!check&&!error&&<p role="status">Checking the seal…</p>}
 {error&&<p role="alert">{error}</p>}
 {check&&!check.sealed&&<><span className="seal-state seal-none">Not sealed</span><p>This inspection was saved before sealing existed, or its files are still uploading.</p></>}
 {check&&latest&&<>
  <span className={`seal-state ${check.intact?'seal-ok':'seal-bad'}`}>{check.intact?'Verified':'Does not verify'}</span>
  <p>{check.intact?`All ${latest.fileCount} evidence files still match the fingerprints taken when they were sealed on ${new Date(latest.sealedAt).toLocaleString()}. The seal's signature is valid and the ledger chain of ${check.chain.length} seals is unbroken.`:'Something has changed since this evidence was sealed:'}</p>
  {!check.intact&&<ul>{check.changedFiles.map(f=><li key={f.name}>{f.name} ({f.kind}): {f.problem}</li>)}{latest.problems.map(p=><li key={p}>{p}</li>)}{check.chain.problems.map(p=><li key={`${p.seq}${p.problem}`}>Ledger entry {p.seq}: {p.problem}</li>)}</ul>}
  <dl><dt>Sealed (server time)</dt><dd>{latest.sealedAt}</dd><dt>Ledger position</dt><dd>#{latest.seq} of {check.chain.length}</dd><dt>Seal</dt><dd>{latest.seal}</dd><dt>Previous seal</dt><dd>{latest.prevSeal}</dd><dt>Files fingerprint</dt><dd>{latest.filesRoot}</dd><dt>Signature (Ed25519)</dt><dd>{short(latest.signature)}</dd><dt>Public key</dt><dd>{check.publicKey} (key {check.keyId})</dd></dl>
  {check.entries.length>1&&<p>This inspection has {check.entries.length} seals; later ones were added when the scan was continued.</p>}
  <p>Each seal is the SHA-256 of these fingerprints, the time and the previous seal, so changing any photo or backdating any inspection breaks every seal after it. Last checked {new Date(check.checkedAt).toLocaleString()}.</p>
 </>}
 <div className="seal-actions"><button className="button button-outline" disabled={busy} onClick={()=>void load()}>{busy?'Checking…':'Verify again'}</button>{check&&!check.sealed&&<button className="button button-dark" disabled={busy} onClick={()=>void load('POST')}>Seal this inspection now</button>}</div>
 </section>;
}
