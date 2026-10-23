import sharp from 'sharp';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export type Detection = { objectId: string; label: string; classId: number; confidence: number; boundingBox: { x: number; y: number; width: number; height: number } };
export const MODEL_NAME = "YOLO11n COCO80";
const SIZE = 640;
// Names and indices are the original COCO classes; unsupported furniture is not relabelled.
export const ROOM_CLASSES: Record<number, string> = { 56: "chair", 57: "couch", 58: "potted plant", 59: "bed", 60: "dining table", 61: "toilet", 62: "tv", 63: "laptop", 68: "microwave", 69: "oven", 70: "toaster", 71: "sink", 72: "refrigerator", 74: "clock", 75: "vase" };
function iou(a: Detection["boundingBox"], b: Detection["boundingBox"]) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}
/** Decode YOLO [1,84,N] output; reverse centered 640px letterbox into source [0,1] coordinates. */
export function decodeDetections(data: Float32Array, dims: readonly number[], width: number, height: number): Detection[] {
  if (dims.length !== 3 || dims[0] !== 1 || dims[1] !== 84 || data.length !== 84 * dims[2] || width <= 0 || height <= 0) throw new Error("Unexpected YOLO tensor shape");
  const count = dims[2], scale = Math.min(SIZE / width, SIZE / height);
  const resizedWidth = Math.round(width * scale), resizedHeight = Math.round(height * scale);
  const padX = Math.floor((SIZE - resizedWidth) / 2), padY = Math.floor((SIZE - resizedHeight) / 2);
  const result: Detection[] = [];
  for (let i = 0; i < count; i++) {
    let classId = 0, confidence = 0;
    for (let c = 0; c < 80; c++) { const score = data[(c + 4) * count + i]; if (score > confidence) { confidence = score; classId = c; } }
    if (!ROOM_CLASSES[classId] || !Number.isFinite(confidence) || confidence < 0.35 || confidence > 1) continue;
    const cx = data[i], cy = data[count + i], w = data[2 * count + i], h = data[3 * count + i];
    if (![cx, cy, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const x1 = Math.max(0, Math.min(1, (cx - w / 2 - padX) / resizedWidth));
    const y1 = Math.max(0, Math.min(1, (cy - h / 2 - padY) / resizedHeight));
    const x2 = Math.max(0, Math.min(1, (cx + w / 2 - padX) / resizedWidth));
    const y2 = Math.max(0, Math.min(1, (cy + h / 2 - padY) / resizedHeight));
    if (x2 <= x1 || y2 <= y1) continue;
    result.push({ objectId: crypto.randomUUID(), label: ROOM_CLASSES[classId], classId, confidence, boundingBox: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  }
  const kept: Detection[] = [];
  for (const candidate of result.sort((a, b) => b.confidence - a.confidence)) {
    if (!kept.some(other => other.classId === candidate.classId && iou(other.boundingBox, candidate.boundingBox) > 0.45)) kept.push(candidate);
    if (kept.length >= 50) break;
  }
  return kept;
}

let modelPromise:Promise<import('onnxruntime-node').InferenceSession>|undefined;
export async function detectImageObjects(image:Buffer):Promise<Detection[]>{
 const ort=await import('onnxruntime-node');
 if(!modelPromise)modelPromise=(async()=>{const bytes=await readFile(path.join(process.cwd(),'public/models/yolo11n.onnx'));if(createHash('sha256').update(bytes).digest('hex')!=='32743404af6bb165ed2405c507114247e5e484b9a91307987cb57d564de7b598')throw new Error('YOLO model integrity failed');return ort.InferenceSession.create(bytes,{executionProviders:['cpu'],intraOpNumThreads:1});})().catch(e=>{modelPromise=undefined;throw e});
 const {data,info}=await sharp(image,{limitInputPixels:24000000}).rotate().removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
 const scale=Math.min(640/info.width,640/info.height),width=Math.round(info.width*scale),height=Math.round(info.height*scale),left=Math.floor((640-width)/2),top=Math.floor((640-height)/2);
 const pixels=await sharp(data,{raw:info}).resize(width,height,{fit:'fill'}).extend({left,top,right:640-width-left,bottom:640-height-top,background:{r:114,g:114,b:114}}).raw().toBuffer();
 const input=new Float32Array(3*640*640);for(let i=0;i<640*640;i++)for(let c=0;c<3;c++)input[c*640*640+i]=pixels[i*3+c]/255;
 const model=await modelPromise;const result=await model.run({[model.inputNames[0]]:new ort.Tensor('float32',input,[1,3,640,640])});const out=result[model.outputNames[0]];return decodeDetections(out.data as Float32Array,out.dims,info.width,info.height);
}
