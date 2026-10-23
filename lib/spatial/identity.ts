import type {SpatialFrame,SpatialElement,Vec3} from './types';
type Box={x:number;y:number;width:number;height:number};
/** Inverse EXIF display orientation: detections use the oriented evidence, calibration uses raw pixels. */
export function rawImagePoint(x:number,y:number,orientation=1):[number,number]{switch(orientation){case 2:return[1-x,y];case 3:return[1-x,1-y];case 4:return[x,1-y];case 5:return[y,x];case 6:return[y,1-x];case 7:return[1-y,1-x];case 8:return[1-y,x];default:return[x,y];}}
export function worldPoint(frame:SpatialFrame,x:number,y:number,depth:number):Vec3|null{const k=frame.intrinsics,t=frame.transform;if(!Number.isFinite(depth)||depth<=0||depth>10||!k[0]||!k[4]||x<0||x>1||y<0||y>1)return null;const p=[(x*frame.width-k[6])*depth/k[0],-(y*frame.height-k[7])*depth/k[4],-depth];const world=[t[0]*p[0]+t[4]*p[1]+t[8]*p[2]+t[12],t[1]*p[0]+t[5]*p[1]+t[9]*p[2]+t[13],t[2]*p[0]+t[6]*p[1]+t[10]*p[2]+t[14]] as Vec3;return world.every(Number.isFinite)?world:null;}
/** Median of a high-confidence local patch; reject depth discontinuities and low-confidence measurements. */
export function depthPoint(frame:SpatialFrame,x:number,y:number,depth:Buffer,confidence:Buffer):Vec3|null{
 const w=frame.depthWidth||0,h=frame.depthHeight||0;if(!w||!h||depth.length!==w*h*4||confidence.length!==w*h)return null;
 const cx=Math.min(w-1,Math.max(0,Math.floor(x*w))),cy=Math.min(h-1,Math.max(0,Math.floor(y*h))),samples:number[]=[];
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const ix=cx+dx,iy=cy+dy;if(ix<0||iy<0||ix>=w||iy>=h)continue;const i=iy*w+ix,z=depth.readFloatLE(i*4);if(confidence[i]===2&&Number.isFinite(z)&&z>.1&&z<=10)samples.push(z);}
 if(samples.length<5)return null;samples.sort((a,b)=>a-b);const median=samples[Math.floor(samples.length/2)];if(samples.at(-1)!-samples[0]>Math.max(.12,median*.05))return null;return worldPoint(frame,x,y,median);
}
const categories:Record<string,string[]>={chair:['chair'],couch:['sofa'],bed:['bed'],'dining table':['table'],toilet:['toilet'],tv:['television'],oven:['oven','stove'],sink:['sink'],refrigerator:['refrigerator']};
/** Only rigid transforms with measured positive dimensions qualify for object association. */
export function insideElement(point:Vec3,element:SpatialElement,tolerance=.08):boolean{const t=element.transform,d=element.dimensions;if(t.length!==16||!t.every(Number.isFinite)||!d.every(v=>Number.isFinite(v)&&v>.01&&v<15))return false;
 const axes=[[t[0],t[1],t[2]],[t[4],t[5],t[6]],[t[8],t[9],t[10]]];const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);if(axes.some(a=>Math.abs(dot(a,a)-1)>.02)||Math.abs(dot(axes[0],axes[1]))>.02||Math.abs(dot(axes[0],axes[2]))>.02||Math.abs(dot(axes[1],axes[2]))>.02)return false;
 const delta=point.map((v,i)=>v-t[12+i]);return axes.every((axis,i)=>Math.abs(dot(delta,axis))<=d[i]/2+tolerance);
}
export function associateElement(label:string,confidence:number,points:Vec3[],elements:SpatialElement[]):SpatialElement|null{if(confidence<.6||points.length<3)return null;const compatible=categories[label];if(!compatible)return null;
 const candidates=elements.filter(e=>compatible.includes(e.category.toLowerCase())&&points.filter(p=>insideElement(p,e)).length>=Math.max(3,Math.ceil(points.length*.8)));
 return candidates.length===1?candidates[0]:null;
}
export function boxDepthPoints(box:Box,frame:SpatialFrame,depth:Buffer,confidence:Buffer,orientation=1):Vec3[]{return [[.5,.5],[.35,.5],[.65,.5],[.5,.35],[.5,.65]].flatMap(([u,v])=>{const [x,y]=rawImagePoint(box.x+u*box.width,box.y+v*box.height,orientation);const p=depthPoint(frame,x,y,depth,confidence);return p?[p]:[];});}
/** Scan-local identity only. Identical native UUIDs in another inspection are not merged. */
export function objectIdentityKey(inspectionId:string,sessionId:string,elementId:string):string{return `${inspectionId}:${sessionId}:${elementId}`;}
