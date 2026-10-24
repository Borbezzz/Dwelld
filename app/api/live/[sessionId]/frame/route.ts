import { after } from 'next/server';
import sharp from 'sharp';
import { authenticateLive, liveCollections, liveFailure, LiveError } from '@/lib/server/live-sessions';
import { readJsonBody, readBinaryBody } from '@/lib/server/request-body';
import { getMediaFile, writeMedia, deleteMedia } from '@/lib/server/media';
import { analyzeLiveEvidenceFrame } from '@/lib/server/native-analysis';
import { validPose } from '@/lib/server/native-live';
export const runtime = 'nodejs'; export const maxDuration = 300;

/** One source photo per captured second. Geometry is stored locally, never sent to the model. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  let uploaded: string | undefined;
  try {
    const { session } = await authenticateLive(request, (await params).sessionId, 'phone');
    if (session.status === 'saved') return Response.json({ saved: true });
    const inline = request.headers.get('content-type')?.split(';')[0] === 'image/jpeg';
    const header = request.headers.get('x-dwelld-frame') || '';
    if (inline && header.length > 8192) throw new LiveError('Frame metadata is too large', 413);
    const b = inline ? JSON.parse(header) : await readJsonBody(request, 32 * 1024);
    const pose = validPose(b.pose);
    if (typeof b.name !== 'string' || !/^[\w.-]{1,120}$/.test(b.name) || !pose || !Number.isFinite(b.timestampSeconds) || b.timestampSeconds < 0 || b.timestampSeconds > 120) throw new LiveError('Invalid frame');
    const sampleSecond = Math.floor(b.timestampSeconds), { db } = await liveCollections(), frames = db.collection('liveFrames');
    await frames.createIndex({ sessionId: 1, sampleSecond: 1 }, { unique: true, partialFilterExpression: { sampleSecond: { $type: 'number' } } });
    const existing = await frames.findOne({ sessionId: session._id, sampleSecond });
    if (existing) {
      if (existing.status === 'queued') after(() => analyzeLiveEvidenceFrame(session._id, existing.name));
      return Response.json({ queued: false, ...(existing.name === b.name ? { ref: existing.ref } : {}) }, { status: 202 });
    }
    let ref = b.ref;
    if (inline) {
      const image = await readBinaryBody(request, 3 * 1024 * 1024);
      const meta = await sharp(image, { limitInputPixels: 24_000_000 }).metadata();
      if (meta.format !== 'jpeg' || meta.width !== pose.width || meta.height !== pose.height) throw new LiveError('Evidence dimensions do not match camera pose');
      ref = uploaded = await writeMedia(image, b.name, 'image/jpeg', { ownerId: session.ownerId, liveSessionId: String(session._id) });
    } else {
      if (typeof ref !== 'string' || !/^gridfs:[a-f0-9]{24}$/.test(ref)) throw new LiveError('Invalid frame reference');
      const file = await getMediaFile(ref);
      if (file?.metadata?.liveSessionId !== String(session._id)) throw new LiveError('Frame does not belong to this scan', 403);
    }
    const inserted = await frames.updateOne({ sessionId: session._id, sampleSecond }, { $setOnInsert: { sessionId: session._id, sampleSecond, name: b.name, ref, pose, timestampSeconds: b.timestampSeconds, status: 'queued', createdAt: new Date() } }, { upsert: true });
    if (!inserted.upsertedCount && uploaded) { await deleteMedia(uploaded); uploaded = undefined; }
    else uploaded = undefined;
    after(() => analyzeLiveEvidenceFrame(session._id, b.name));
    return Response.json({ queued: !!inserted.upsertedCount, ...(inserted.upsertedCount ? { ref } : {}) }, { status: 202 });
  } catch (e) {
    if (uploaded) await deleteMedia(uploaded).catch(() => {});
    return liveFailure(e);
  }
}
