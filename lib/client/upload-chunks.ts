/** Bounded parallel, byte-exact uploads. A retry resends the same idempotent part. */
export async function uploadChunks(file:Blob,size:number,write:(part:number,chunk:Blob)=>Promise<unknown>,progress?:(percent:number)=>void,concurrency=3){
 if(!Number.isSafeInteger(size)||size<1)throw new Error('Invalid upload chunk size');
 const count=Math.ceil(file.size/size);let cursor=0,completed=0,failure:unknown;
 const worker=async()=>{while(cursor<count&&!failure){const part=cursor++,chunk=file.slice(part*size,Math.min(file.size,(part+1)*size));try{
  try{await write(part,chunk)}catch{await write(part,chunk)}
  completed+=chunk.size;progress?.(Math.min(99,Math.round(completed/file.size*100)));
 }catch(error){failure=error}}};
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),count)},worker));
 if(failure)throw failure;
}
