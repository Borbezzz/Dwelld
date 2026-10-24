import type {SpatialManifest,SpatialElement,SpatialFrame} from "./types";
export type RoomBoundary={id:string;doorId:string;timestamp:number;from:number;to:number;label:string;status:"suggested"|"confirmed"|"rejected"};
const xyz=(m:number[])=>[m[12],m[13],m[14]];
function side(door:SpatialElement,frame:SpatialFrame){
 const p=xyz(frame.transform),d=xyz(door.transform),v=[p[0]-d[0],p[1]-d[1],p[2]-d[2]];
 const x=v[0]*door.transform[0]+v[1]*door.transform[1]+v[2]*door.transform[2];
 const y=v[0]*door.transform[4]+v[1]*door.transform[5]+v[2]*door.transform[6];
 const z=v[0]*door.transform[8]+v[1]*door.transform[9]+v[2]*door.transform[10];
 return {x,y,z};
}
/** Only suggests crossings backed by measured doors AND movement of the tracked camera. */
export function suggestRoomBoundaries(manifest:Pick<SpatialManifest,"elements"|"frames">):RoomBoundary[]{
 const frames=[...manifest.frames].sort((a,b)=>a.timestamp-b.timestamp);
 if(frames.length<4)return [];
 const doors=manifest.elements.filter(e=>e.category.toLowerCase().startsWith("door")&&e.transform.length===16&&e.dimensions.length===3);
 const proposed:{doorId:string;timestamp:number}[]=[];
 for(const door of doors){
  let previous:{sign:number;time:number}|null=null,last=-Infinity;
  for(const frame of frames){
   const p=side(door,frame),halfWidth=door.dimensions[0]/2;
   if(Math.abs(p.x)>halfWidth+.45||Math.abs(p.y)>Math.max(1.5,door.dimensions[1])||Math.abs(p.z)>1.25)continue;
   const sign=p.z>.25?1:p.z<-.25?-1:0;
   if(!sign)continue;
   if(previous&&sign!==previous.sign&&frame.timestamp-previous.time<=5&&frame.timestamp-last>=6){
    const at=(frame.timestamp+previous.time)/2;
    proposed.push({doorId:door.id,timestamp:at});last=at;
   }
   previous={sign,time:frame.timestamp};
  }
 }
 proposed.sort((a,b)=>a.timestamp-b.timestamp);
 return proposed.filter((p,i)=>!i||p.timestamp-proposed[i-1].timestamp>=2).slice(0,19).map((p,i)=>({
  id:`door-${p.doorId}-${Math.round(p.timestamp*1000)}`,doorId:p.doorId,timestamp:p.timestamp,from:i+1,to:i+2,label:`Room ${i+2}`,status:"suggested" as const
 }));
}
