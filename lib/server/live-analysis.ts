import {logAIFailure} from "./analysis-failure";
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { inspectVisibleDamage, validBox } from './damage';
import { deleteMedia, writeMedia } from './media';
import type { LiveAnalysisObject, LiveAnalysisResult, LiveDamageFinding } from '../live/detection-types';

const LABELS: Record<number,string> = {56:'chair',57:'couch',58:'potted plant',59:'bed',60:'dining table',61:'toilet',62:'tv',63:'laptop',68:'microwave',69:'oven',70:'toaster',71:'sink',72:'refrigerator',74:'clock',75:'vase'};
export type LiveAnalysisInput = {sessionId:string;observationId:string;timestampSeconds:number;objects:LiveAnalysisObject[];includeSurfaces:boolean;fullFrame?:boolean};
/** Caller owns session authentication, persisted throttle and observation idempotency. */
export async function analyzeLiveFrame(image: Buffer, input: LiveAnalysisInput): Promise<LiveAnalysisResult> {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(input.sessionId)||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.observationId)||!Number.isFinite(input.timestampSeconds)||input.timestampSeconds<0)throw new Error('Invalid live frame identity');
  if(!Array.isArray(input.objects)||input.objects.length>4||typeof input.includeSurfaces!=='boolean')throw new Error('Select at most four objects per damage analysis');
  const ids=new Set<string>();
  for(const object of input.objects){
    if(!object||typeof object.objectId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(object.objectId)||ids.has(object.objectId)||LABELS[object.classId]!==object.label||!validBox(object.boundingBox))throw new Error('Invalid live object observation');
    ids.add(object.objectId);
  }
  if(!input.objects.length&&!input.includeSurfaces)throw new Error('Select an object or room surfaces to analyze');
  if(!image.length||image.length>3*1024*1024)throw new Error('Evidence image must be smaller than 3 MiB');
  const metadata=await sharp(image,{limitInputPixels:24_000_000}).metadata();
  if(!metadata.width||!metadata.height||!['jpeg','png','webp'].includes(metadata.format||'')||metadata.pages&&metadata.pages>1)throw new Error('Invalid evidence image');
  // Normalize before storage and Gemini: returned dimensions always describe the preserved evidence.
  const normalized=await sharp(image,{limitInputPixels:24_000_000}).rotate().png().toBuffer();
  const size=await sharp(normalized).metadata();
  const ref=await writeMedia(normalized,`live/${input.sessionId}/${input.observationId}.png`,'image/png');
  try{
    let damage: Awaited<ReturnType<typeof inspectVisibleDamage>> = [];
    const analysisWarnings:string[]=[];
    try { damage=await inspectVisibleDamage(normalized); }
    catch(error) { logAIFailure('live.damage',error); analysisWarnings.push('Argon damage analysis could not finish. This view remains unassessed.'); }
    const findings:LiveDamageFinding[]=damage.map(item=>({id:randomUUID(),parentObjectId:null,label:item.type,description:item.description,boundingBox:item.boundingBox,timestampSeconds:input.timestampSeconds,damageType:item.type,source:'ai',detectionSource:'gemini'}));
    return {analysisWarnings,evidenceFrameRef:ref,sourceWidth:size.width!,sourceHeight:size.height!,findings,analyzedObjectIds:analysisWarnings.length?[]:input.objects.map(o=>o.objectId),surfacesAnalyzed:!analysisWarnings.length};
  }catch(error){await deleteMedia(ref).catch(()=>{});throw error;}
}
