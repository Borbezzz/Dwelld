export type UploadState={status:string;url?:string;contentType?:string;parts?:number[]};
/** A lost final response is recovered from server state, without resending a finished file. */
export async function finalizeUpload(complete:()=>Promise<UploadState>,readState:()=>Promise<UploadState>,options:{signal?:AbortSignal;onWaiting?:()=>void;timeoutMs?:number;wait?:(ms:number)=>Promise<void>}={}){
 const deadline=Date.now()+(options.timeoutMs??120_000);let attempts=0,lastError:unknown;
 let state:UploadState={status:'uploading'};
 while(Date.now()<deadline){
  options.signal?.throwIfAborted();
  if(state.status==='uploading'&&attempts<3){attempts++;try{state=await complete();if(state.url)return state;}catch(error){lastError=error;const status=(error as {status?:number}).status;if(status&&status!==409&&status!==408&&status!==429&&status<500)throw error;}}
  options.onWaiting?.();
  try{state=await readState();if(state.status==='complete'&&state.url)return state;}catch(error){lastError=error;const status=(error as {status?:number}).status;if(status===401||status===403||status===404)throw error;}
  if(state.status==='uploading'&&attempts>=3)break;
  await (options.wait||((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))))(Math.min(3000,750*attempts));
 }
 options.signal?.throwIfAborted();
 throw new Error(`The file transfer is retained, but the final save could not be confirmed. Retry save to resume.${lastError instanceof Error?` ${lastError.message}`:''}`);
}
