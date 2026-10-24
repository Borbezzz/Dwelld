import { ObjectId, type Db } from "mongodb";
import { analyzeVideo } from "./inspection";
import { autoReviewInspection } from "./verify";
import { indexFindings } from "./search";
import { reportError } from "./api-error";

/** Shared by initial uploads and saved-video recovery; keeps the same evidence rules. */
export async function runVideoInspection(db: Db, inspectionId: ObjectId, ownerId: string, roomId: ObjectId, videoUrl: string, mimeType: string, detectionFrames: unknown) {
  const inspections = db.collection("inspections");
      try {
        const result = await analyzeVideo(videoUrl, mimeType, detectionFrames);
        await inspections.updateOne({ _id: inspectionId }, { $set: { evidenceFrames:result.evidenceFrames, analysisRunId:result.analysisRunId, analysisWarnings:result.warnings, durationSeconds:result.durationSeconds } });
        // Every observation has its own identity, including objects sharing a label.
        const ids = result.findings.map(() => new ObjectId());
        const objectIds = new Map<string, ObjectId>();
        result.findings.forEach((finding, index) => {
          if (finding.kind === "object" && finding.detectionId) objectIds.set(finding.detectionId, ids[index]);
        });
        const docs = result.findings.map((finding, index) => ({
          _id: ids[index], ownerId:ownerId, inspectionId, roomId, ...finding,
          objectId: finding.parentDetectionId ? objectIds.get(finding.parentDetectionId) || null : null,
          source: "ai", reviewStatus: "pending", reviewHistory: [], createdAt: new Date(),
        }));
        if (docs.length) await db.collection("findings").insertMany(docs);
        const review = await autoReviewInspection(inspectionId, {limit:6, concurrency:3, timeoutMs:15_000, deadlineMs:Date.now()+35_000}).catch(() => null);
        await inspections.updateOne({ _id: inspectionId }, { $set: { ...(review ? { autoReview: review } : {}), status: result.warnings.length ? "partial" : "completed", analysisWarnings: result.warnings, durationSeconds: result.durationSeconds, completedAt: new Date() } });
        await indexFindings(ownerId,inspectionId,{limit:6,timeoutMs:5000,deadlineMs:Date.now()+10_000}).catch(()=>{});
      } catch (error) {
        const failure = reportError(error, "inspection.analyze");
        const message = `${failure.error} Request ID: ${failure.requestId}`;
        await inspections.updateOne({ _id: inspectionId }, { $set: { status: "failed", error: message, failedAt: new Date() } });
      }
}
