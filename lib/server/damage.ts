import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

/** Normalized top-left x/y and width/height, relative to the displayed source image. */
export type Box = { x: number; y: number; width: number; height: number };
export const DAMAGE_TYPES = ["scratch", "crack", "stain", "dent", "chipped paint", "tear", "broken component", "other"] as const;
export type DamageObservation = { type: typeof DAMAGE_TYPES[number]; description: string; boundingBox: Box | null };

export function validBox(value: unknown): Box | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Box;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.00000001 || y + height > 1.00000001) return null;
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

export function cropBoxToFrame(box: Box, crop: Box): Box {
  if (!validBox(box) || !validBox(crop)) throw new Error("Invalid normalized crop coordinates");
  return { x: crop.x + box.x * crop.width, y: crop.y + box.y * crop.height, width: box.width * crop.width, height: box.height * crop.height };
}

export async function cropObject(image: Buffer, box: Box): Promise<{ image: Buffer; bounds: Box }> {
  if (!validBox(box)) throw new Error("Invalid object crop coordinates");
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error("Could not read evidence frame dimensions");
  const left = Math.floor(box.x * width), top = Math.floor(box.y * height);
  const right = Math.min(width, Math.ceil((box.x + box.width) * width));
  const bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
  const cropWidth = right - left, cropHeight = bottom - top;
  if (cropWidth < 1 || cropHeight < 1) throw new Error("Object crop contains no pixels");
  return {
    image: await sharp(image).extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer(),
    bounds: { x: left / width, y: top / height, width: cropWidth / width, height: cropHeight / height },
  };
}

export function parseDamageResponse(text: string): DamageObservation[] {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !("damage" in parsed) || !Array.isArray(parsed.damage) || parsed.damage.length > 30) {
    throw new Error("Gemini returned an invalid damage response");
  }
  return parsed.damage.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Gemini returned an invalid damage observation");
    const item = raw as Record<string, unknown>;
    if (!DAMAGE_TYPES.includes(item.type as DamageObservation["type"]) || typeof item.description !== "string" || !item.description.trim() || item.description.length > 2000) {
      throw new Error("Gemini returned an invalid damage observation");
    }
    const boundingBox = validBox(item.boundingBox);
    if (item.boundingBox !== null && !boundingBox) throw new Error("Gemini returned invalid damage coordinates");
    return { type: item.type as DamageObservation["type"], description: item.description.trim(), boundingBox };
  });
}

async function inspect(image: Buffer, scope: string): Promise<DamageObservation[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini damage analysis requires GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 45_000 } });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-4-argon",
    contents: [
      { inlineData: { data: image.toString("base64"), mimeType: "image/png" } },
      { text: `Inspect this original-resolution image for visible physical damage. ${scope} Only report visible scratches, cracks, stains, dents, chipped paint, tears, broken components or other physical damage. Do not mistake texture, shadows, reflections, seams or ordinary design for damage. Do not infer hidden damage or liability. Return an empty damage array when none is visible. Express uncertainty in the description; do not invent confidence scores. Each box uses normalized top-left x,y,width,height in [0,1] relative to THIS image. Use null when you cannot localize a visible observation. Return at most 30 observations.` },
    ],
    config: { responseMimeType: "application/json", responseSchema: {
      type: "OBJECT", properties: { damage: { type: "ARRAY", items: {
        type: "OBJECT", properties: {
          type: { type: "STRING", enum: [...DAMAGE_TYPES] }, description: { type: "STRING" },
          boundingBox: { type: "OBJECT", nullable: true, properties: {
            x: { type: "NUMBER" }, y: { type: "NUMBER" }, width: { type: "NUMBER" }, height: { type: "NUMBER" },
          }, required: ["x", "y", "width", "height"] },
        }, required: ["type", "description", "boundingBox"],
      } } }, required: ["damage"],
    } },
  });
  if (!response.text) throw new Error("Gemini returned no damage observations");
  return parseDamageResponse(response.text);
}

export async function inspectObjectDamage(image: Buffer, label: string, box: Box): Promise<DamageObservation[]> {
  const crop = await cropObject(image, box);
  const observations = await inspect(crop.image, `This is a crop of a detected ${JSON.stringify(label)}. Inspect that object only.`);
  return observations.map((item) => ({ ...item, boundingBox: item.boundingBox ? cropBoxToFrame(item.boundingBox, crop.bounds) : null }));
}

export async function inspectSurfaceDamage(image: Buffer): Promise<DamageObservation[]> {
  return inspect(await sharp(image).png().toBuffer(), "Inspect room surfaces only: walls, floors, ceilings and skirting. Exclude furniture, fixtures and appliances, which are inspected separately.");
}
