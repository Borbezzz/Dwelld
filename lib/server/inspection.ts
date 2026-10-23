import { GoogleGenAI } from "@google/genai";
import { get as getBlob } from "@vercel/blob";

export type Box = { x: number; y: number; width: number; height: number };
export type AnalyzedFinding = {
  kind: "object" | "damage";
  label: string;
  description: string;
  timestampSeconds: number;
  boundingBox: Box | null;
  objectLabel: string | null;
  evidenceFrameUrl: null;
  reviewStatus: "unreviewed";
};

const inspectionSchema = {
  type: "OBJECT",
  properties: {
    durationSeconds: { type: "NUMBER" },
    findings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["object", "damage"] },
          label: { type: "STRING" },
          description: { type: "STRING" },
          timestampSeconds: { type: "NUMBER" },
          // Coordinates use normalized top-left origin [0,1].
          boundingBox: {
            type: "OBJECT",
            nullable: true,
            properties: {
              x: { type: "NUMBER" }, y: { type: "NUMBER" },
              width: { type: "NUMBER" }, height: { type: "NUMBER" },
            },
            required: ["x", "y", "width", "height"],
          },
          objectLabel: { type: "STRING", nullable: true },
        },
        required: ["kind", "label", "description", "timestampSeconds", "boundingBox", "objectLabel"],
      },
    },
  },
  required: ["durationSeconds", "findings"],
} as const;

function validBox(value: unknown): Box | null {
  if (!value || typeof value !== "object") return null;
  const b = value as Record<string, unknown>;
  const { x, y, width, height } = b;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if ((x as number) < 0 || (y as number) < 0 || (width as number) <= 0 || (height as number) <= 0 ||
      (x as number) + (width as number) > 1 || (y as number) + (height as number) > 1) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function parseModelJson(text: string): { durationSeconds: number; findings: AnalyzedFinding[] } {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Gemini returned an invalid inspection response");
  const root = parsed as Record<string, unknown>;
  const duration = root.durationSeconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || !Array.isArray(root.findings)) {
    throw new Error("Gemini returned an incomplete inspection response");
  }
  const findings = root.findings.flatMap((raw): AnalyzedFinding[] => {
    if (!raw || typeof raw !== "object") return [];
    const f = raw as Record<string, unknown>;
    if ((f.kind !== "object" && f.kind !== "damage") || typeof f.label !== "string" ||
        typeof f.description !== "string" || typeof f.timestampSeconds !== "number" ||
        !Number.isFinite(f.timestampSeconds) || f.timestampSeconds < 0 || f.timestampSeconds > duration) return [];
    const objectLabel = typeof f.objectLabel === "string" && f.objectLabel.trim() ? f.objectLabel.trim() : null;
    return [{
      kind: f.kind, label: f.label.slice(0, 100), description: f.description.slice(0, 1000),
      timestampSeconds: f.timestampSeconds, boundingBox: validBox(f.boundingBox), objectLabel,
      evidenceFrameUrl: null, reviewStatus: "unreviewed",
    }];
  });
  return { durationSeconds: duration, findings };
}

export async function analyzeVideo(videoUrl: string, mimeType: string): Promise<{ durationSeconds: number; findings: AnalyzedFinding[] }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini analysis is unavailable: GEMINI_API_KEY is not configured");
  const normalizedMimeType = mimeType.split(";")[0].trim().toLowerCase();
  const allowed = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"]);
  if (!allowed.has(normalizedMimeType)) throw new Error("Unsupported video format");
  let pathname: string;
  try {
    const parsedUrl = new URL(videoUrl);
    if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".private.blob.vercel-storage.com")) throw new Error();
    pathname = decodeURIComponent(parsedUrl.pathname.slice(1));
  } catch { throw new Error("Video URL must refer to a private Vercel Blob upload"); }
  const blob = await getBlob(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new Error("Could not retrieve the uploaded inspection video");
  const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("Video exceeds the 100 MB analysis limit");

  const ai = new GoogleGenAI({ apiKey: key });
  const uploaded = await ai.files.upload({
    file: new Blob([bytes], { type: normalizedMimeType }),
    config: { mimeType: normalizedMimeType, displayName: "dwelld-room-inspection" },
  });
  if (!uploaded.name) throw new Error("Gemini did not return a file reference");
  try {
    let file = uploaded;
    const deadline = Date.now() + 120_000;
    while (file.state === "PROCESSING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = await ai.files.get({ name: uploaded.name });
    }
    if (file.state !== "ACTIVE" || !file.uri) throw new Error("Gemini could not process the uploaded video");

    const model = process.env.GEMINI_MODEL || "gemini-4-argon";
    const prompt = "Inspect this tenant move-in walkthrough. Return distinct physical objects once (avoid duplicates across frames), and visible damage only when clearly observable. Do not infer hidden condition or legal responsibility. Give the best timestamp in seconds for each finding. For each finding, provide a box for the exact timestamp frame only, with normalized top-left x,y,width,height coordinates in [0,1]; use null if localization is uncertain. Link damage to an object using objectLabel where possible; use null for an unlinked wall/floor/surface. Mark uncertainty in description. Do not invent confidence scores. Estimate video duration in seconds.";
    const result = await ai.models.generateContent({
      model,
      contents: [
        { fileData: { fileUri: file.uri, mimeType: file.mimeType || normalizedMimeType } },
        { text: prompt },
      ],
      config: { responseMimeType: "application/json", responseSchema: inspectionSchema },
    });
    if (!result.text) throw new Error("Gemini returned no inspection data");
    return parseModelJson(result.text);
  } finally {
    await ai.files.delete({ name: uploaded.name }).catch(() => undefined);
  }
}
