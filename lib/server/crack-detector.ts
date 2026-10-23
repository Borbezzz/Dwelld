import sharp from 'sharp';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Box} from './damage';
const MODEL_SHA256='4b789658646d790079d3e78d9d3ed475030d740a4b8412aff52248189a114cbd';
export const CRACK_MODEL='smart-crack-vision-yolov8n-seg';
type Candidate={boundingBox:Box;confidence:number};
let sessionPromise:Promise<import('onnxruntime-node').InferenceSession>|undefined;
async function session(){
 if(!sessionPromise)sessionPromise=(async()=>{
  const ort=await import('onnxruntime-node');
  const bytes=await readFile(path.join(process.cwd(),'public/models/crack-seg.onnx'));
  if(createHash('sha256').update(bytes).digest('hex')!==MODEL_SHA256)throw new Error('Crack model integrity check failed');
  return ort.InferenceSession.create(bytes,{executionProviders:['cpu'],intraOpNumThreads:1,interOpNumThreads:1});
 })().catch(e=>{sessionPromise=undefined;throw e});
 return sessionPromise;
}
function iou(a:Box,b:Box){const intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return intersection/(a.width*a.height+b.width*b.height-intersection)}
/** Decode crack boxes only. Mask coefficients are not represented as pixel-accurate boundaries. */
export function decodeCracks(data:ArrayLike<number>,dims:readonly number[],width:number,height:number):Candidate[]{
 if(dims.length!==3||dims[0]!==1||dims[1]!==37||dims[2]!==8400)throw new Error('Unsupported crack model output');
 const n=dims[2],scale=Math.min(640/width,640/height),rw=Math.round(width*scale),rh=Math.round(height*scale),px=Math.floor((640-rw)/2),py=Math.floor((640-rh)/2);const boxes:Candidate[]=[];
 for(let i=0;i<n;i++){
  const score=data[4*n+i];if(!Number.isFinite(score)||score<.45||score>1)continue;
  const cx=data[i],cy=data[n+i],w=data[2*n+i],h=data[3*n+i];if(![cx,cy,w,h].every(Number.isFinite)||w<=0||h<=0)continue;
  const x=Math.max(0,Math.min(1,(cx-w/2-px)/rw)),y=Math.max(0,Math.min(1,(cy-h/2-py)/rh));
  const right=Math.max(0,Math.min(1,(cx+w/2-px)/rw)),bottom=Math.max(0,Math.min(1,(cy+h/2-py)/rh));
  if(right>x&&bottom>y)boxes.push({confidence:score,boundingBox:{x,y,width:right-x,height:bottom-y}});
 }
 const selected:Candidate[]=[];for(const box of boxes.sort((a,b)=>b.confidence-a.confidence)){if(selected.every(other=>iou(other.boundingBox,box.boundingBox)<.45))selected.push(box);if(selected.length===8)break;}return selected;
}
/** Pretrained specialist: surface cracks only; no structural severity or other damage categories. */
async function inspectCrackView(image:Buffer):Promise<Candidate[]>{
 const {data,info}=await sharp(image,{limitInputPixels:24_000_000}).rotate().removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
 const scale=Math.min(640/info.width,640/info.height),width=Math.round(info.width*scale),height=Math.round(info.height*scale);
 const left=Math.floor((640-width)/2),top=Math.floor((640-height)/2);
 const pixels=await sharp(data,{raw:info}).resize(width,height,{fit:'fill'}).extend({left,top,right:640-width-left,bottom:640-height-top,background:{r:114,g:114,b:114}}).raw().toBuffer();
 const input=new Float32Array(3*640*640);for(let i=0;i<640*640;i++){input[i]=pixels[i*3]/255;input[640*640+i]=pixels[i*3+1]/255;input[2*640*640+i]=pixels[i*3+2]/255;}
 const ort=await import('onnxruntime-node'),model=await session();const output=await model.run({images:new ort.Tensor('float32',input,[1,3,640,640])});
 const predictions=output.output0;return decodeCracks(predictions.data as Float32Array,predictions.dims,info.width,info.height);
}

/** Full view plus overlapping quadrants preserve thin cracks lost by whole-frame resizing. */
export async function inspectCracks(image:Buffer):Promise<Candidate[]>{
 const normalized=await sharp(image,{limitInputPixels:24_000_000}).rotate().removeAlpha().png().toBuffer();
 const meta=await sharp(normalized).metadata(),width=meta.width!,height=meta.height!;
 const candidates=await inspectCrackView(normalized);
 if(Math.max(width,height)>=960){
  const w=Math.ceil(width*.6),h=Math.ceil(height*.6);
  for(const [left,top] of [[0,0],[width-w,0],[0,height-h],[width-w,height-h]]){
   const crop=await sharp(normalized).extract({left,top,width:w,height:h}).png().toBuffer();
   for(const c of await inspectCrackView(crop))candidates.push({confidence:c.confidence,boundingBox:{x:(left+c.boundingBox.x*w)/width,y:(top+c.boundingBox.y*h)/height,width:c.boundingBox.width*w/width,height:c.boundingBox.height*h/height}});
  }
 }
 const result:Candidate[]=[];for(const c of candidates.sort((a,b)=>b.confidence-a.confidence)){if(result.every(r=>iou(r.boundingBox,c.boundingBox)<.35))result.push(c);if(result.length===12)break;}return result;
}
