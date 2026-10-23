'use client';
import { detectObjects } from './detector';
import { cropSignature, LiveTracker, type Track } from './live-tracker';
export type LiveFrame = { objects: Track[]; sourceWidth: number; sourceHeight: number; timestampSeconds: number; latencyMs: number; capture: () => Promise<Blob> };
let inferenceBusy = false;
export type LiveDetectionOptions = { targetFps?: number; onFrame: (frame: LiveFrame) => void; onError?: (error: Error) => void; startTime?: number };
/** JPEG evidence is capped for Vercel's request limit; normalized boxes remain unchanged. */
export async function captureEvidence(source: HTMLCanvasElement): Promise<Blob> {
  const canvas=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(source.width,source.height));
  canvas.width=Math.round(source.width*scale);canvas.height=Math.round(source.height*scale);
  const context=canvas.getContext('2d');if(!context)throw new Error('Evidence encoding is unavailable');
  context.drawImage(source,0,0,canvas.width,canvas.height);
  for(const quality of [.92,.8,.65,.45]){
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Evidence encoding failed')),'image/jpeg',quality));
    if(blob.size<=1.5*1024*1024)return blob;
  }
  throw new Error('Evidence frame is too large; try a lower camera resolution');
}
/** Runs serial inference, targeting 2–5 FPS only when device latency permits. */
export function startLiveDetection(video: HTMLVideoElement, options: LiveDetectionOptions): () => void {
  const tracker=new LiveTracker(), period=1000/Math.max(2,Math.min(5,options.targetFps||3));
  const started=options.startTime??performance.now();
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  async function tick(){
    if(stopped)return;
    const began=performance.now();
    let acquired=false;
    try{
      if(!inferenceBusy&&video.readyState>=2&&video.videoWidth&&video.videoHeight&&!video.paused){
        inferenceBusy=true;acquired=true;
        // Snapshot once: signatures, boxes and any requested evidence all share this exact source frame.
        const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
        const context=canvas.getContext('2d');if(!context)throw new Error('Camera frame capture is unavailable');
        context.drawImage(video,0,0);
        const timestampSeconds=(began-started)/1000;
        const detections=await detectObjects(canvas);
        if(stopped)return;
        const objects=tracker.update(detections,detections.map(d=>cropSignature(canvas,d.boundingBox)),timestampSeconds);
        options.onFrame({objects,sourceWidth:canvas.width,sourceHeight:canvas.height,timestampSeconds,latencyMs:performance.now()-began,capture:()=>captureEvidence(canvas)});
      }
    }catch(error){if(!stopped)options.onError?.(error instanceof Error?error:new Error('Live detection failed'));}
    finally {if(acquired)inferenceBusy=false;}
    if(!stopped)timer=setTimeout(tick,Math.max(0,period-(performance.now()-began)));
  }
  void tick();
  return()=>{stopped=true;if(timer)clearTimeout(timer);tracker.reset();};
}
