import {finalizeUpload,type UploadState} from "./upload-finalize";
import {uploadChunks} from "./upload-chunks";
export async function liveRequest<T>(id: string, token: string, path = '', init: RequestInit = {}): Promise<T> {
  const controller=new AbortController();let timedOut=false;
  const cancel=()=>controller.abort(init.signal?.reason);
  init.signal?.addEventListener('abort',cancel,{once:true});
  if(init.signal?.aborted)cancel();
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},!init.method||init.method==='GET'?20_000:60_000);
  try {
    const response=await fetch(`/api/live/${id}${path}`,{...init,signal:controller.signal,headers:{...(init.body instanceof FormData||init.body instanceof Blob?{}:{'Content-Type':'application/json'}),...init.headers,Authorization:`Bearer ${token}`},cache:'no-store'});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw Object.assign(new Error((body?.error||`Request failed (${response.status})`)+(body?.requestId?` · ${body.requestId}`:'')),{status:response.status});
    return body;
  } catch(error) {
    if(timedOut)throw new Error('The laptop connection timed out. Reconnecting automatically; keep Dwelld open on your phone.');
    if(error instanceof TypeError)throw new Error('Connection to Dwelld was interrupted. Reconnecting automatically; your phone capture has not been marked as failed.');
    throw error;
  } finally {clearTimeout(timer);init.signal?.removeEventListener('abort',cancel);}

}
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), v=>v.toString(16).padStart(2,'0')).join(''); }
const liveUploads=new WeakMap<Blob,{sessionId:string;uploadId:string;parts:Set<number>;complete:boolean}>();
export async function uploadLiveVideo(id:string,token:string,file:Blob,onProgress:(n:number)=>void) {
 const contentType=file.type.split(';')[0];
 let upload=liveUploads.get(file);if(upload?.sessionId!==id)upload=undefined;
 if(upload?.complete){onProgress(100);return;}
 if(!upload){const init=await liveRequest<{uploadId:string}>(id,token,'/upload',{method:'POST',body:JSON.stringify({filename:`walkthrough.${contentType.includes('mp4')?'mp4':'webm'}`,contentType,size:file.size})});upload={sessionId:id,uploadId:init.uploadId,parts:new Set(),complete:false};liveUploads.set(file,upload);}
 const size=2*1024*1024;
 await uploadChunks(file,size,(part,chunk)=>liveRequest(id,token,`/upload?uploadId=${upload.uploadId}&part=${part}`,{method:'PATCH',body:chunk,headers:{'Content-Type':'application/octet-stream'}}),onProgress,3,{completedParts:upload.parts});
 const uploadId=upload.uploadId;await finalizeUpload(()=>liveRequest<UploadState>(id,token,'/upload',{method:'POST',body:JSON.stringify({action:'complete',uploadId})}),()=>liveRequest<UploadState>(id,token,`/upload?uploadId=${uploadId}`));upload.complete=true;onProgress(100);
}
