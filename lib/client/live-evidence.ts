import {captureEvidence} from './live-detection';
/** Preserve one camera snapshot per second independently of YOLO and model response time. */
export function sampleLiveEvidence(video:HTMLVideoElement,start:number,write:(sample:{blob:Blob;timestampSeconds:number;name:string})=>Promise<unknown>,onError:(error:Error)=>void){
 type Sample={blob:Blob;timestampSeconds:number;name:string};
 const queue:Sample[]=[],retry:Sample[]=[],encoding=new Set<Promise<void>>(),jobs=new Set<Promise<void>>();let stopped=false;
 function pump(){while(queue.length&&jobs.size<2){const sample=queue.shift()!;const job=(async()=>{try{try{await write(sample)}catch{await write(sample)}}catch(error){retry.push(sample);onError(error instanceof Error?error:new Error('Evidence upload interrupted'))}})();jobs.add(job);void job.finally(()=>{jobs.delete(job);pump()})}}
 function capture(){if(stopped||video.readyState<2||!video.videoWidth)return;const timestampSeconds=(performance.now()-start)/1000;if(timestampSeconds>=120)return;
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');if(!ctx)return;ctx.drawImage(video,0,0);
  const job=captureEvidence(canvas).then(blob=>{queue.push({blob,timestampSeconds,name:`browser-frame-${Math.floor(timestampSeconds)}.jpg`});pump()}).catch(error=>{onError(error instanceof Error?error:new Error('Frame capture failed'))});encoding.add(job);void job.finally(()=>encoding.delete(job));
 }
 const timer=setInterval(capture,1000);capture();
 return {cancel(){stopped=true;clearInterval(timer)},async stop(){stopped=true;clearInterval(timer);queue.push(...retry.splice(0));pump();await Promise.all(encoding);while(queue.length||jobs.size){pump();await Promise.all(jobs)}if(retry.length)throw new Error(`${retry.length} source photos still need upload. Retry save to preserve every captured sample.`)}};
}
