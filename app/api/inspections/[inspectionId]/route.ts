import {groupedReportFlags} from "@/lib/server/comparison-dedup";
import {groupedDamage} from "@/lib/server/damage-groups";
import {recoverStalledInspection} from "@/lib/server/processing-recovery";
import { requireUser, requireOwnedInspection } from "@/lib/server/access";
import { canReadRoom,requireReadableInspection } from "@/lib/server/space-access";
import { deleteInspection } from "@/lib/server/delete";
import { errorResponse } from "@/lib/server/api-error";
import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  const id = parseObjectId(inspectionId);
  if (!id) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  try {
    const user = await requireUser(request);
    const db = await getDb();
    const inspection = await requireReadableInspection(id,user.id);
    const requestedRoom=new URL(request.url).searchParams.get("roomId");
    const targetId=requestedRoom?parseObjectId(requestedRoom):inspection.roomId;
    if(!targetId)return NextResponse.json({error:"Invalid room"},{status:400});
    const segment=await db.collection("roomScanSegments").findOne({sourceInspectionId:id,roomId:targetId});
    if(String(targetId)!==String(inspection.roomId)){
      const target=await db.collection("rooms").findOne({_id:targetId});
      if(!segment||!target||!await canReadRoom(target as never,user.id))return NextResponse.json({error:"Room not found"},{status:404});
    }
    await recoverStalledInspection(db,inspection);
    const findingFilter={inspectionId:id,reportEntry:{$ne:true},...(segment?{timestampSeconds:{$gte:segment.startTime,$lt:segment.endTime}}:{})};
    const rawFindings = await db.collection("findings").find(findingFilter).sort({ createdAt: 1 }).toArray();
    const findings=await groupedDamage(db,id,rawFindings);
    const serializedFindings = findings.map((f) => ({
      evidenceObservations:f.evidenceObservations,sourceObservationIds:f.sourceObservationIds,visualCheck:f.visualCheck, id: String(f._id), kind: f.kind, label: f.label, description: f.description,
      timestampSeconds: f.timestampSeconds, evidenceFrameUrl: f.evidenceFrameUrl,
      detectionSource: f.detectionSource === "yolo" || f.detectionSource === "gemini" || f.detectionSource === "crack-model" || f.detectionSource === "roomplan" ? f.detectionSource : undefined,
      visibilityIntervals: f.visibilityIntervals, userNote:f.userNote, boundingBox: f.boundingBox ?? null, point: f.point ?? null, source: f.source ?? "ai", damageType: f.damageType ?? null, reviewStatus: f.reviewStatus, uncertain: !f.boundingBox && !f.point,
      objectId: f.objectId ? String(f.objectId) : null, objectLabel: f.objectLabel ?? null, spatialElementId: f.spatialElementId ?? null, confidence: typeof f.confidence === "number" ? f.confidence : null, autoApproved: !!f.autoApproved, verification: f.verification ? { verdict: f.verification.verdict, confidence: f.verification.confidence, reason: f.verification.reason } : null,
    }));
    return NextResponse.json({
      inspection: {
        captureSource: inspection.captureSource || "video", id: String(inspection._id), roomId: String(targetId), status: inspection.status, type: inspection.type || "move-in",isOwner:inspection.ownerId===user.id,virtual:String(targetId)!==String(inspection.roomId),
        createdAt: new Date(inspection.createdAt).toISOString(),
    comparisonProgress:inspection.comparisonProgress,comparisonBaselineCreatedAt:inspection.comparisonBaselineCreatedAt,baselineInspectionId:inspection.baselineInspectionId?String(inspection.baselineInspectionId):undefined, reportComparisonStatus:inspection.reportComparisonStatus, searchIndexStatus:inspection.searchIndexStatus, searchIndexError:inspection.searchIndexError, framesAnalysed:inspection.framesAnalysed,

        videoUrl: typeof inspection.sourceUrl === "string" ? "/api/inspections/" + String(inspection._id) + "/video" : undefined,
        durationSeconds: inspection.durationSeconds ?? null,
        analysisWarnings: inspection.analysisWarnings ?? [],
        evidenceFrames: segment?(inspection.evidenceFrames??[]).filter((f:{timestampSeconds:number})=>f.timestampSeconds>=segment.startTime&&f.timestampSeconds<segment.endTime):inspection.evidenceFrames??[],
        scanReportStatus: inspection.scanReportStatus,
        scanReport: segment ? null : inspection.scanReport ?? null,
        scanReportError: inspection.scanReportError ?? null,
        reportComparison: segment ? null : await groupedReportFlags(db,inspection.reportComparison),
        reportComparisonError: inspection.reportComparisonError ?? null,
        analysisRunId: inspection.analysisRunId ?? null,
        analysisProgress: inspection.analysisProgress ?? null,
        error: inspection.status === "failed" ? "Video analysis failed. Check service configuration and retry with a supported video." : null,
      },
      findings: serializedFindings,
    });
  } catch (error) {
    return errorResponse(error, "app/api/inspections/[inspectionId]/route.ts");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  try {
    const user = await requireUser(request);
    const inspection = await requireOwnedInspection((await params).inspectionId, user.id);
    const db=await getDb();const segments=await db.collection("roomScanSegments").find({sourceInspectionId:inspection._id},{projection:{roomId:1}}).toArray();
    if(segments.some(s=>String(s.roomId)!==String(inspection.roomId)))return NextResponse.json({error:"This scan supplies evidence for linked rooms. Remove those room sections first."},{status:409});
    if(segments.length)await db.collection("roomScanSegments").deleteMany({sourceInspectionId:inspection._id,roomId:inspection.roomId});
    if (inspection.status === "processing" || inspection.status === "queued") {
      const started = new Date(inspection.updatedAt || inspection.createdAt).getTime();
      if (Date.now() - started < 10 * 60_000) return NextResponse.json({ error: "This scan is still being analysed. Try deleting it in a few minutes." }, { status: 409 });
    }
    return NextResponse.json({ deleted: true, ...(await deleteInspection(inspection)) });
  } catch (error) { return errorResponse(error, "inspection.delete"); }
}
