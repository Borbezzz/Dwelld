import { createHash } from 'node:crypto';
import type { SpatialManifest } from '../spatial/types';

/** A continued or corrected capture invalidates both cloud and report measurements. */
export function objectCaptureSignature(manifest: SpatialManifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
