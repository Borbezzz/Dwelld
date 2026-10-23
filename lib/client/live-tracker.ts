import type { Detection } from './detector';

export type { TrackedObject as Track } from '../live/detection-types';
import type { TrackedObject as Track } from '../live/detection-types';
type State = { track: Track; signature: number[] };
export function overlap(a: Detection['boundingBox'], b: Detection['boundingBox']) {
  const area = Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return area / (a.width*a.height+b.width*b.height-area || 1);
}
function similarity(a: number[], b: number[]) { return a.length === b.length && a.length > 0 ? a.reduce((sum,v,i)=>sum+Math.min(v,b[i]),0) : 0; }
/** Normalized RGB histogram, only a matching hint; never a room-wide identity claim. */
export function cropSignature(canvas: HTMLCanvasElement, box: Detection['boundingBox']): number[] {
  const sample = document.createElement('canvas'); sample.width = 16; sample.height = 16;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(canvas,box.x*canvas.width,box.y*canvas.height,box.width*canvas.width,box.height*canvas.height,0,0,16,16);
  const data=ctx.getImageData(0,0,16,16).data, bins=Array<number>(24).fill(0);
  for(let i=0;i<data.length;i+=4) for(let c=0;c<3;c++) bins[c*8+Math.min(7,Math.floor(data[i+c]/32))]+=1/(256*3);
  return bins;
}
export class LiveTracker {
  private states: State[] = [];
  constructor(private readonly expirySeconds = 2.5) {}
  reset() { this.states = []; }
  update(detections: Detection[], signatures: number[][], timestampSeconds: number): Track[] {
    this.states = this.states.filter(s=>timestampSeconds-s.track.lastSeenSeconds <= this.expirySeconds && timestampSeconds >= s.track.lastSeenSeconds);
    const candidates: {di:number;si:number;score:number}[]=[];
    detections.forEach((d,di)=>this.states.forEach((s,si)=>{
      if(d.classId!==s.track.classId) return;
      const iou=overlap(d.boundingBox,s.track.boundingBox), visual=similarity(signatures[di]||[],s.signature);
      // Require overlap even with matching colours: nearby identical chairs stay distinct.
      if(iou>=0.2 && (iou>=0.55 || visual>=0.55)) candidates.push({di,si,score:iou*.8+visual*.2});
    }));
    candidates.sort((a,b)=>b.score-a.score);
    const usedD=new Set<number>(),usedS=new Set<number>(), matches=new Map<number,number>();
    for(const c of candidates) if(!usedD.has(c.di)&&!usedS.has(c.si)){usedD.add(c.di);usedS.add(c.si);matches.set(c.di,c.si);}
    return detections.map((d,di)=>{
      const index=matches.get(di), prior=index===undefined?undefined:this.states[index];
      const track:Track={...d,objectId:prior?.track.objectId||crypto.randomUUID(),firstSeenSeconds:prior?.track.firstSeenSeconds??timestampSeconds,lastSeenSeconds:timestampSeconds,observations:(prior?.track.observations||0)+1};
      const state={track,signature:signatures[di]||[]};
      if(index!==undefined)this.states[index]=state;else this.states.push(state);
      return track;
    });
  }
}
