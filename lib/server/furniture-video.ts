import {damageViewSignature,damageCropSignature} from './damage-signature';
import type { DepthPatch } from './depth-patch';
import { inspectVideoDamageBatch } from './damage';
import { analyzeEvidenceFrame, type FramePose, type RoomElement } from './frame-analysis';

/** One source frame per captured second; preserve the exact timestamp and its calibrated pose. */
export function oneFramePerSecond<T extends { timestampSeconds: number }>(frames: T[]): T[] {
  const seconds = new Set<number>();
  return [...frames].sort((a, b) => a.timestampSeconds - b.timestampSeconds).filter(frame => {
    if (!Number.isFinite(frame.timestampSeconds) || frame.timestampSeconds < 0) throw new Error('Invalid evidence timestamp');
    const second = Math.floor(frame.timestampSeconds);
    if (seconds.has(second)) return false;
    seconds.add(second); return true;
  });
}

/** Provider gets pixels + timestamps only. Room geometry is used AFTER the visual assessment. */
export async function analyzeFurnitureVideoFrames<T extends { image: Buffer; timestampSeconds: number; pose?: FramePose; depth?: DepthPatch | null }>(frames: T[], elements: RoomElement[]) {
  const observations = await inspectVideoDamageBatch(frames.map(({ image, timestampSeconds }) => ({ image, timestampSeconds })));
  return Promise.all(frames.map(async frame => {
    const damage = observations.get(frame.timestampSeconds);
    if (!damage) throw new Error('Furniture analysis omitted a source frame');
    const result:Awaited<ReturnType<typeof analyzeEvidenceFrame>> = frame.pose ? await analyzeEvidenceFrame(frame.image, frame.pose, elements, {
      walls: false, observations: damage, verify: false, specialist: false, furnitureOnly: true, depth: frame.depth,
    }) : {findings:damage.map(o=>({label:o.type,description:o.description,damageType:o.type,boundingBox:o.boundingBox,elementId:null,elementCategory:'unassigned',worldPosition:null,detectionSource:'gemini' as const,reviewStatus:'pending' as const,autoApproved:false})),views:[],dropped:0,warnings:[]};
    const viewSignature=await damageViewSignature(frame.image);
    const findings=await Promise.all(result.findings.map(async f=>({...f,viewSignature,cropSignature:await damageCropSignature(frame.image,f.boundingBox),objectBoundingBox:result.views.find(v=>v.elementId===f.elementId)?.box})));
    return { frame, result: {...result,findings,objects:observations.objects?.get(frame.timestampSeconds)||[]} };
  }));
}
