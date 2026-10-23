# Move-in / move-out comparison

## Implemented

- Upload and live creation offer an explicit move-in/move-out purpose; the value persists on inspections. Comparison selection also permits earlier/later records without inferring their purpose from dates.
- `/rooms/[roomId]/compare` selects two completed/partial inspections. The API checks ownership, same room, distinct identities, and chronological order.
- Gemini receives real saved evidence, at most six distinct frames per side, and at most 100 observation metadata records per side. Original and submitted image SHA-256 hashes, model name, prompt version, evidence snapshots, IDs and timestamps persist with the comparison.
- Live furniture records without an image use exact timestamp extraction from the original GridFS recording. Zero-finding recordings use three actual recorded views, explicitly labelled as views and never as model detections.
- Structured output rejects invented evidence IDs, malformed categories, duplicate pairs and oversized responses. Missing detections cannot establish a missing object. Non-comparable viewpoints downgrade new/changed/not-visible claims to uncertain.
- Confirm/reject/reset and review notes persist atomically with revocable `observationCorrespondences`. Originals are never destructively merged. These are human-confirmed links, not an assertion of globally stable physical identity.
- A per-owner/room expiring lease prevents concurrent expensive comparisons; errors release it, and process interruptions expire it. Failed model runs remove their generated frames.
- Native-only inspections without video use bounded original RGB images from their owned spatial manifest; these remain recorded views rather than detections.
- Side-by-side saved evidence includes original normalized boxes/points and timestamps. Both native spatial captures can be shown in their own coordinate systems. Linked findings highlight their own attached spatial element; coordinates are never transferred across capture sessions.

## Verification performed 23 October 2026

- Six parser tests pass (`tests/comparison.test.cjs`). Full TypeScript check passes.
- Real authenticated local API integration used a clearly labelled test room and two two-second videos encoded from the same actual furnished-room photograph. Neither inspection contained synthetic object or damage detections.
- Real Gemini returned three unchanged proposals from six FFmpeg-extracted GridFS image frames. Private frame retrieval returned 200. Evidence hashes were present.
- Confirm created review history and a durable correspondence; rejection deactivated the link. Reopening returned the saved comparison.
- Negative API checks passed: identical inspection IDs 400, reversed chronology 400, inaccessible/nonexistent inspection 404, anonymous comparison read 401.
- Browser sign-in, saved comparison rendering, side-by-side actual photographs, confirm action and expanded three-event review history verified at localhost:3002. Screenshots: `/tmp/dwelld-comparison-top.png`, `/tmp/dwelld-comparison-browser.png`.
- Fixture metadata without credentials: `/tmp/dwelld-comparison-result.json`. Authentication fixture is private and must not be logged.

## Limits

This smoke proves the real comparison/storage/review flow on unchanged images. It does not measure changed-room matching accuracy or claim that omitted views establish absence. Physical LiDAR capture, reconstruction, and spatial highlighting need native capture evidence. Candidate correspondences remain reviewable; comparison is not a liability assessment. Atlas network access and auth configuration remain operational prerequisites.

## Native within-scan identity safeguards

Native analysis normalizes camera evidence to oriented JPEG at no more than 1600 pixels per side and below 3 MiB. Depth projection inverts EXIF orientation back into the original calibrated pixel frame; mismatched image/calibration sizes disable association.

Grouping requires high confidence depth samples (ARKit confidence 2), a consistent local median depth patch, at least three projected points, a YOLO score of at least 0.6, compatible object categories, and a unique measured oriented bounding volume containing at least 80% of projected points. Nearby centers alone do not establish identity. Missing confidence, discontinuities, overlapping candidate objects, incompatible categories and invalid geometry remain unresolved. Canonical IDs include inspection ID, native session ID and RoomPlan UUID; they never merge across inspections. Each canonical object keeps all per-frame evidence observations, and user reviews/edited markers are preserved.

Eight spatial identity tests pass, including a real noisy native JPEG larger than 3 MiB, confidence/discontinuity rejection, bounding-volume/category ambiguity, coordinate orientation, and inspection-scoped IDs. These are algorithm tests, not a claim of physical LiDAR accuracy validation.
