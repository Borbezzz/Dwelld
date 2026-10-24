/** Bounded parallel, byte-exact uploads. A retry resends the same idempotent part. */
export async function uploadChunks(file:Blob,size:number,write:(part:number,chunk:Blob)=>Promise<unknown>,progress?:(percent:number)=>void,concurrency=3,options:{completedParts?:Set<number>;onRetry?:(part:number,attempt:number)=>void;wait?:(ms:number)=>Promise<void>}={}){
 if(!Number.isSafeInteger(size)||size<1)throw new Error('Invalid upload chunk size');
 const count=Math.ceil(file.size/size);let cursor=0,completed=0,failure:unknown;
 for(const part of options.completedParts||[])if(part>=0&&part<count)completed+=Math.min(size,file.size-part*size);
 if(completed)progress?.(Math.min(99,Math.round(completed/file.size*100)));
 const worker=async()=>{while(cursor<count&&!failure){const part=cursor++;if(options.completedParts?.has(part))continue;const chunk=file.slice(part*size,Math.min(file.size,(part+1)*size));try{
  for(let attempt=1;;attempt++)try{await write(part,chunk);break;}catch(error){
   const status=(error as {status?:number}).status;
   if(attempt>=3||(error as Error).name==='AbortError'||(status!=null&&![408,425,429].includes(status)&&status<500))throw error;
   options.onRetry?.(part,attempt+1);await (options.wait||((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))))(350*2**(attempt-1));
  }
  options.completedParts?.add(part);
  completed+=chunk.size;progress?.(Math.min(99,Math.round(completed/file.size*100)));
 }catch(error){failure=error}}};
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),count)},worker));
 if(failure)throw failure;
}
