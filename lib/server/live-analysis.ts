import {inspectCracks, CRACK_MODEL} from './crack-detector';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { inspectVisibleDamage, inspectObjectDamage, inspectSurfaceDamage, validBox } from './damage';
import { deleteMedia, writeMedia } from './media';
import type { LiveAnalysisObject, LiveAnalysisResult, LiveDamageFinding } from '../live/detection-types';

const LABELS: Record<number,string> = {56:'chair',57:'couch',58:'potted plant',59:'bed',60:'dining table',61:'toilet',62:'tv',63:'laptop',68:'microwave',69:'oven',70:'toaster',71:'sink',72:'refrigerator',74:'clock',75:'vase'};
export type LiveAnalysisInput = {sessionId:string;observationId:string;timestampSeconds:number;objects:LiveAnalysisObject[];includeSurfaces:boolean;fullFrame?:boolean};
/** Caller owns session authentication, persisted throttle and observation idempotency. */
export async function analyzeLiveFrame(image: Buffer, input: LiveAnalysisInput): Promise<LiveAnalysisResult> {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(input.sessionId)||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.observationId)||!Number.isFinite(input.timestampSeconds)||input.timestampSeconds<0)throw new Error('Invalid live frame identity');
  if(!Array.isArray(input.objects)||input.objects.length>3||typeof input.includeSurfaces!=='boolean')throw new Error('Select at most three objects per damage analysis');
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
    if (input.fullFrame) {
      const results = await Promise.allSettled([inspectVisibleDamage(normalized), inspectCracks(normalized)]);
      const analysisWarnings: string[] = [];
      const findings: LiveDamageFinding[] = [];
      const damage = results[0], cracks = results[1];
      if (damage.status === 'fulfilled') damage.value.forEach(item => findings.push({ id: randomUUID(), parentObjectId: null, label: item.type, description: item.description, boundingBox: item.boundingBox, timestampSeconds: input.timestampSeconds, damageType: item.type, source: 'ai', detectionSource: 'gemini' }));
      else analysisWarnings.push('Whole-frame damage analysis could not finish. This view remains unassessed.');
      if (cracks.status === 'fulfilled') cracks.value.forEach(item => findings.push({ id: randomUUID(), parentObjectId: null, label: 'Potential crack', description: 'Specialist crack candidate; review the source image.', boundingBox: item.boundingBox, timestampSeconds: input.timestampSeconds, damageType: 'crack', source: 'ai', detectionSource: 'crack-model' }));
      else analysisWarnings.push('Specialist crack analysis could not finish.');
      return { analysisWarnings, evidenceFrameRef: ref, sourceWidth: size.width!, sourceHeight: size.height!, findings, analyzedObjectIds: damage.status === 'fulfilled' ? input.objects.map(o => o.objectId) : [], surfacesAnalyzed: damage.status === 'fulfilled' };
    }
    const findings:LiveDamageFinding[]=[];const analysisWarnings:string[]=[];
    const checks=await Promise.allSettled([
      ...input.objects.map(async object=>{
        const observations=await inspectObjectDamage(normalized,object.label,object.boundingBox);
        findings.push(...observations.map(item=>({id:randomUUID(),parentObjectId:object.objectId,label:`${object.label}: ${item.type}`,description:item.description,boundingBox:item.boundingBox,timestampSeconds:input.timestampSeconds,damageType:item.type,source:'ai' as const})));
      }),
      ...(input.includeSurfaces?[inspectSurfaceDamage(normalized).then(observations=>{
        findings.push(...observations.map(item=>({id:randomUUID(),parentObjectId:null,label:`Room surface: ${item.type}`,description:item.description,boundingBox:item.boundingBox,timestampSeconds:input.timestampSeconds,damageType:item.type,source:'ai' as const})));
      })]:[]),
      ...(input.includeSurfaces?[inspectCracks(normalized).then(cracks=>{findings.push(...cracks.map(crack=>({id:randomUUID(),parentObjectId:null,label:'Potential crack',description:`Pretrained crack model candidate (${CRACK_MODEL}, ${(crack.confidence*100).toFixed(0)}% model score); review against the source image. Joints and shadows can be false positives.`,boundingBox:crack.boundingBox,timestampSeconds:input.timestampSeconds,damageType:'crack',source:'ai' as const,detectionSource:'crack-model' as const})));})]:[]),
    ]);
    const analyzedObjectIds=input.objects.filter((object,index)=>{if(checks[index].status==='fulfilled')return true;analysisWarnings.push(`Damage check for ${object.label} could not finish. Assessment is incomplete.`);return false}).map(object=>object.objectId);
    const surfacesAnalyzed=input.includeSurfaces&&checks[input.objects.length]?.status==='fulfilled';
    if(input.includeSurfaces&&!surfacesAnalyzed)analysisWarnings.push('Gemini surface analysis could not finish. Assessment is incomplete.');
    if(input.includeSurfaces){const specialist=checks[input.objects.length+1];if(specialist?.status==='rejected')analysisWarnings.push('Specialised crack detection was unavailable. Gemini observations are retained; crack assessment is incomplete.');}
    return{analysisWarnings,evidenceFrameRef:ref,sourceWidth:size.width!,sourceHeight:size.height!,findings,analyzedObjectIds,surfacesAnalyzed};
  }catch(error){await deleteMedia(ref).catch(()=>{});throw error;}
}
