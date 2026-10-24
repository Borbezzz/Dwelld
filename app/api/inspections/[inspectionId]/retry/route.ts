import { ObjectId } from "mongodb";
import { after, NextResponse } from "next/server";
import { requireUser, requireOwnedInspection, requireOwnedRoom } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/api-error";
import { getDb } from "@/lib/server/db";
import { getMediaFile, parseMediaId } from "@/lib/server/media";
import { validateDetectionFrames } from "@/lib/server/inspection";
import { runVideoInspection } from "@/lib/server/run-video-inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** New attempt, original record untouched. Atomic link makes repeat requests idempotent. */
export async function POST(request: Request, {params}: {params: Promise<{inspectionId:string}>}) {
  try {
    const user = await requireUser(request);
    const source = await requireOwnedInspection((await params).inspectionId, user.id);
    if (!['partial','failed'].includes(source.status)) return NextResponse.json({error:'Only incomplete or failed video inspections can be retried.'},{status:409});
    await requireOwnedRoom(source.roomId, user.id);
    const db = await getDb(), inspections = db.collection('inspections');
    if (source.retryInspectionId) {
      const previous = await inspections.findOne({_id:source.retryInspectionId, ownerId:user.id});
      if (previous) return NextResponse.json({inspection:{id:String(previous._id)}},{status:200});
      // Another request may have claimed the link but not inserted its record yet.
      if (source.retryRequestedAt && Date.now()-new Date(source.retryRequestedAt).getTime()<5*60_000) return NextResponse.json({error:'A retry is being prepared. Please try again in a moment.'},{status:409});
      // A deleted or abandoned retry can be recreated after the preparation window.
      await inspections.updateOne({_id:source._id,retryInspectionId:source.retryInspectionId},{$unset:{retryInspectionId:''}});
    }
    if (!parseMediaId(source.sourceUrl || '')) return NextResponse.json({error:'This record does not have a saved video to retry.'},{status:409});
    const media = await getMediaFile(source.sourceUrl);
    if (!media || media.metadata?.ownerId !== user.id) return NextResponse.json({error:'The original video is no longer available.'},{status:404});
    const detectionFrames = validateDetectionFrames(source.detectionFrames);
    const id = new ObjectId();
    const claimed = await inspections.findOneAndUpdate({_id:source._id, ownerId:user.id, retryInspectionId:{$exists:false}},{$set:{retryInspectionId:id,retryRequestedAt:new Date()}});
    if (!claimed) {
      const current = await inspections.findOne({_id:source._id, ownerId:user.id});
      const existing=current?.retryInspectionId&&await inspections.findOne({_id:current.retryInspectionId,ownerId:user.id});
      return existing?NextResponse.json({inspection:{id:String(existing._id)}}):NextResponse.json({error:'A retry is being prepared. Please try again in a moment.'},{status:409});
    }
    try {
      await inspections.insertOne({_id:id, ownerId:user.id, roomId:source.roomId, type:source.type||'move-in',...(source.baselineInspectionId?{baselineInspectionId:source.baselineInspectionId}:{}), sourceUrl:source.sourceUrl, videoMimeType:source.videoMimeType, detectionFrames, detector:source.detector||'yolo11n-coco', sourceInspectionId:source._id, status:'processing', createdAt:new Date(), durationSeconds:null});
    } catch (error) {
      await inspections.updateOne({_id:source._id,retryInspectionId:id},{$unset:{retryInspectionId:''}});
      throw error;
    }
    after(()=>runVideoInspection(db,id,user.id,source.roomId,source.sourceUrl,source.videoMimeType,detectionFrames));
    return NextResponse.json({inspection:{id:String(id)}},{status:201});
  } catch(error) { return errorResponse(error,'inspection.retry'); }
}
