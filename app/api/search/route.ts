import { NextResponse } from "next/server";
import { getDb, parseObjectId } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const roomParam = url.searchParams.get("roomId");
  const roomId = roomParam ? parseObjectId(roomParam) : null;
  const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20));
  if (roomParam && !roomId) return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
  if (q.length < 2) return NextResponse.json({ results: [], search: "atlas-search" });
  if (q.length > 200) return NextResponse.json({ error: "Search query is too long" }, { status: 400 });

  try {
    const db = await getDb();
    const pipeline: object[] = [{
      $search: {
        index: "findings_search",
        compound: {
          should: [
            { text: { query: q, path: "label", score: { boost: { value: 3 } }, fuzzy: { maxEdits: 1 } } },
            { text: { query: q, path: "description", fuzzy: { maxEdits: 1 } } },
          ],
          minimumShouldMatch: 1,
          ...(roomId ? { filter: [{ equals: { path: "roomId", value: roomId } }] } : {}),
        },
      },
    }, { $limit: limit }, {
      $project: { _id: 1, inspectionId: 1, roomId: 1, kind: 1, label: 1, description: 1, timestampSeconds: 1, reviewStatus: 1, score: { $meta: "searchScore" } },
    }];
    const results = await db.collection("findings").aggregate(pipeline).toArray();
    return NextResponse.json({ results: results.map((r) => ({
      id: String(r._id), inspectionId: String(r.inspectionId), roomId: String(r.roomId),
      type: r.kind, label: r.label, description: r.description,
      timestamp: r.timestampSeconds, reviewStatus: r.reviewStatus, score: r.score,
    })), search: "atlas-search" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Atlas Search failed";
    if (/index|search/i.test(message)) return NextResponse.json({ error: "Atlas Search index unavailable. Configure the findings_search index described in docs/mongodb-atlas-search.md." }, { status: 503 });
    return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid request body" : "The service could not complete this request. Check server configuration and try again." }, { status: error instanceof SyntaxError ? 400 : message.includes("not configured") ? 503 : 500 });
  }
}
