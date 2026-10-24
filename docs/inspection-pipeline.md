# Inspection reliability and the Shepherd architecture

The supplied Shepherd diagram separates capture, object/video understanding, a rules engine,
a second reviewer, saved observations, and request tracing. Those boundaries fit Dwelld.
Dwelld already has YOLO11 detection, schema-validated Gemini observations, an adversarial
verification pass, private MongoDB/GridFS evidence, and an authenticated web API.

## Changes implemented

- **Independent stages:** save timestamped evidence and actual YOLO detections before requesting
  damage or supplementary furniture analysis. Either AI branch can fail without discarding the
  other branch or specialist crack candidates.
- **Bounded recovery:** retry transient provider failures once with a small backoff. Stop issuing
  further Gemini calls for the inspection after an explicit billing, credential or model block.
  Distinguish these from an ordinary temporary 429 rate limit.
- **Safe traces:** each video analysis has a run ID. Structured stage logs contain its scope,
  attempt, duration and safe error category, without provider payloads, keys or source images.
- **Evidence-backed recovery:** retry the saved video into a new inspection, preserving the old
  report and its review history. An atomic retry link prevents double-clicks from creating
  duplicate attempts. The video remains private and shared source media survives deleting
  either attempt.
- **Honest review UI:** incomplete checks have a compact reason, expandable details and a real
  retry button. Saved source frames and the original walkthrough are available even when the
  AI returns no findings. No observations are fabricated to fill an empty report.
- **Bounded verification:** video verification has a per-call timeout, a deadline and a maximum
  of six candidates so optional review cannot consume the entire function budget.

## Useful next boundary

The current runner uses Next.js `after()` inside a 300-second function. This is bounded background
execution, **not a durable queue**. For captures requiring longer processing, persist a job and
per-frame stage checkpoints, use a worker with a lease/heartbeat, retry only unfinished stages,
and persist observations as each stage finishes. Keep capture/review available during failures.
This should precede adding another large vision provider or a GPU service.

The diagram's tracing concept can later connect these safe run IDs to an external tracing
system. It does not require sending room photos or descriptions to a new service. No Weave,
CoreWeave, VAST, Nemotron or Twilio account or integration was provisioned by this change.
A service migration should follow measured quality, latency and cost evaluation on consented
room fixtures; changing vendors alone does not repair evidence loss or credential failures.

## Incident evidence (24 October 2026)

Inspection `6adc9133b69e07d735513317` contained 47 browser samples and 24 object detections,
but zero persisted findings. The old batch loop awaited damage generation before retaining
objects, so damage failures discarded those detections. A live call initially returned a Gemini
monthly billing-cap error; a replacement key initially returned `API_KEY_INVALID`. Report these
as service blocks rather than suggesting the room is undamaged. Provider availability must be
verified with a structured **image** request as well as a tiny text request. With the updated
key, tiny text, image and two-frame structured requests succeeded, but the affected video's
larger damage request still returned a billing block. Its repair nevertheless recovered 47
source evidence images, 20 unique browser object findings and 78 specialist crack candidates.
All 98 observations remained pending review; crack candidates are not confirmed damage.

## Validation

Regression checks cover failed damage batches preserving evidence/objects and independent
furniture/crack results, blocked-service circuit breaking, transient recovery, sanitized
classification, timestamp coverage and parser validation. Full live analysis additionally
requires valid provider billing/credentials and a signed-in owner of a saved video.

## Incremental review and source playback

Video analysis now serializes checkpoints after source extraction and after each completed
batch. Findings are inserted once with stable IDs, without overwriting human review decisions.
The record exposes actual frame counts and a verification phase while analysis continues.
Published source media remains available if a later checkpoint fails. Processing still uses
bounded `after()` execution; checkpoints do not make the job a durable queue.

Video review uses one original-video player. Timestamp markers seek and pause at the assessed
moment; hovering or focusing a mark shows its description. Boxes are visible only within
0.4 seconds of their source timestamp, rather than pretending to track objects across frames.
Native live observations show their exact source photo in an inset without hiding the camera. Saved captures expose a prominent next/review action independently
of whether optional analysis has finished. Transient laptop polling failures preserve progress,
retry automatically, and distinguish a quiet phone upload from a failed scan.

## Pairing lifetime

Each QR creates a session with a fixed owner, room and inspection purpose. Repeating an
unfinished phone claim remains idempotent; a saved claim cannot be paired again. Saved
sessions reject capture mutations, while read access and idempotent final-save acknowledgement
remain available to recover a lost response.

New phone pairings replace RoomPlan's capture view and clear all in-memory capture, evidence,
findings, geometry, upload-cache and stream state. A connection generation fences late network
responses; chunk requests keep the original session and token. Saved phone claims are removed
from secure storage. Original capture files remain on the phone. The laptop remounts the live
workspace on room/session navigation, aborts outgoing polls and closes media resources after
save; continuing analysis is viewed from the saved room record.

## Live video is separate from inference

Native ARKit camera buffers now feed a WebRTC video source targeting 30 FPS at 540 × 960.
The sender rotates sensor pixels clockwise into portrait using Core Image and pooled buffers,
then sends zero rotation metadata so playback does not depend on RTP orientation support.
RoomPlan keeps its own ARSession; no second camera is opened.
Only offer/answer/ICE metadata passes through the authenticated signalling API. Video goes
over the negotiated peer connection, using configured TURN credentials when needed. The native
sender polls a lightweight signalling endpoint instead of downloading its own JPEG preview.
Camera buffers are read at 60 Hz, duplicate ARKit timestamps are ignored, and WebRTC adapts
to 30 FPS independently of evidence sampling. Network and device conditions can reduce
the delivered rate; the laptop displays measured incoming FPS.

Furniture boxes and damage pins travel over a bounded, unordered metadata channel at about
6 Hz. They use the current AR camera and measured world geometry; the browser rejects invalid,
out-of-order and stale marks. Unlocalized damage remains on its exact source photo. Incoming
findings and evidence selection never replace or hide the live video. Source photos open in an
inset, with independently scrollable findings and a camera panel that stays in view on desktop. The once-per-second
JPEG is a fallback, labelled as connecting while WebRTC is unavailable.

Evidence upload and Gemini calls keep their separate, slower schedule. Crack candidates publish
as soon as the specialist finishes, even while Gemini is pending or unavailable. Service failures
are classified and shown on the laptop and phone; a provider spending cap is not described as
slow inference. Saved analysis also retains specialist results if a Gemini batch fails. All crack
candidates remain pending unless verified or reviewed; a quick candidate is not confirmed damage.

Google's Live API is a separate model interface accepting sampled image inputs (documented at
up to 1 FPS), not a replacement for the display video stream. This change does not switch the
app to Live API or repair provider billing. Browser loopback transport tests use synthetic media;
actual iPhone FPS and cross-network connectivity still require a physical scan.

Before installing a native build with embedded frameworks, run
`python3 scripts/verify-ios-bundle.py /path/to/DwelldCapture.app`. It checks dynamic-library
resolution using the built Mach-O runtime search paths, then verifies nested signatures.
The app target requires `@executable_path/Frameworks` for both Debug and Release. A successful
compile alone does not verify that dyld can load WebRTC on an iPhone.

A physical scan exposed a playback regression: hovering findings selected an old source photo,
which hid the video element and could pause decoding. The laptop briefly reported 22 FPS before
that transition. Evidence inspection now leaves the video element visible, and the remote stream
is retained independently of element mounting. A browser regression check confirms playback time
continues to advance while the selected source-photo inset is open. Production frame checks from
that scan also confirmed `AI_BILLING_BLOCKED`; the specialist still published candidates.

## Furniture-only sampled video (24 October 2026)

The native phone scan now selects one RGB evidence photo per captured second. JPEG uploads go
through a single authenticated, bounded `/api/live/[sessionId]/frame` request carrying the
calibrated pose as backend-only metadata. The legacy uploaded-reference request remains supported.
A unique session/second key prevents upload retries or overlapping samples from creating extra
checks. Unsent evidence remains in the saved capture; stopping does not wait for the entire live
upload backlog. Display video continues independently over WebRTC.

A single leased worker consumes queued photos chronologically in batches of up to six. Argon
receives only JPEG pixels, timestamps, a furniture-only prompt and the output schema. No depth,
LiDAR points, room geometry, camera transforms, or detector boxes enter the provider request.
The prompt asks for obvious scratches, cracks, stains, dents, tears, chips and broken components
on chairs, sofas, beds, tables/desks and storage furniture. Tiny specks, texture, shadows, normal
seams, bedding and non-furniture room surfaces are excluded. Temporal context is limited to the
short batch; this is not a persistent Live API conversation or a raw video upload.

Structured results are validated against every source timestamp and projected on the backend
using the exact source photo's intrinsics and camera transform. The nearest measured surface
must be furniture to receive the mark; otherwise the source-photo box remains unassigned rather
than forcing a match through an occluding wall. On saving, existing live findings are reprojected
against the final room without another model request. Completed seconds are reused; remaining
seconds are checked within the function time budget. Missing checks remain explicitly unassessed.

This native path no longer runs the crack specialist or automatic per-finding Gemini verification.
The existing edge/depth check can still screen returned crack boxes locally; its geometry never enters the Argon payload. Candidates remain pending human review. Manual marking remains available. Legacy browser/video
paths still have their separate specialist and verification stages; the shared Argon batch prompt
is furniture-only. Provider billing/access blocks stop subsequent native calls, including the
saved pass, while retaining evidence. Safe batch logs record counts of input, output and reasoning
tokens when supplied by the provider; they contain no photos, keys or geometry.

Validation: provider-payload, source-pose association, non-furniture occlusion, one-second sampling,
upload idempotency, session ownership and image/pose dimension checks have regression coverage.
The signed native build and embedded-framework verification pass. A real two-photo provider probe
still returned `AI_BILLING_BLOCKED`; inference quality and sustained physical scan throughput
cannot be verified until that service block is resolved. One sampled frame per second is the
input target, not a promise of one completed model result per second.

## Exact manual snapshots and recorded playback

A phone mark saves the current AR frame as an upright JPEG, its exact fractional timestamp,
its normalized aim point and image dimensions, plus a world position when LiDAR is available.
The photo and mark metadata remain on the phone for retries; saving a paired inspection waits
for unsent marks rather than dropping them. A saved finding opens its own evidence photo,
including when the scan also has continuous video. It never substitutes a nearby sampled frame.

Gemini receives that snapshot with the aim point ringed and an unmarked target crop. Boxes
are expressed in crop coordinates, mapped back by the server, and rejected if invalid or away
from the aim point. An undamaged or unlocalized response keeps the manual pin without a box.
The provider output remains a visual assessment, not a guarantee that a region is correct.

New native scans record upright H.264 MP4 at a 30 FPS target, with original camera aspect ratio,
on a separate camera sampling and encoding queue. Evidence collection and model analysis retain
their slower independent schedules. The MP4 is a session-owned spatial asset, uploaded in the
existing bounded chunks and played as video. Continued scans retain separate recordings with
start offsets. Static evidence boxes appear on their exact source photos, rather than being
carried across moving native video. Legacy captures containing only sampled JPEGs remain a
labelled photo timeline; missing video frames cannot be recovered from those samples.

Validation: `npm test`, `npm run lint`, unsigned device `xcodebuild`, and
`scripts/verify-native-recording.sh` on macOS. The recorder test encodes and decodes actual H.264,
checks 30 FPS and portrait dimensions, and checks pixel colors after clockwise rotation.
A fresh physical-device scan is still required to verify delivered cadence and upload end to end.

### Room report and checkout inventory

Every completion path (uploaded video, browser live capture, native LiDAR and imported spatial capture) calls `finishScanReport` before publishing the terminal inspection status. Argon receives up to 16 evenly spaced saved views and a fixed prompt in `lib/server/scan-report.ts`. It records a room summary, inventory groups including loose items such as pillows, visible counts, source timestamps and coverage limitations. Repeated views must not inflate counts. The server validates counts and requires inventory timestamps to match supplied images.

The report is stored on the inspection, shown in review and the room overview, and included in printed/JSON exports. A separate `reportEntry` in the existing findings collection carries searchable report text; indexing prioritizes it for the existing Atlas keyword and vector indexes. It is excluded from marker lists and detector inventory so the report does not become another physical object.

Move-out completion compares with the latest earlier ready move-in scan owned by the same account in the same room. Comparisons receive report inventory as evidence-linked observations, the two text reports, and original images. A count change can be flagged as potentially missing/changed only with a comparable current image of that location; a missing detection or obscured location remains uncertain. Saved comparisons keep the existing confirm/dismiss workflow. Automatic comparison failures are recorded without discarding the scan; comparison can still be run from the room page.

Manual notes are untrusted context for `describeAtPoint`, including when the note is empty. Visual verdicts are kept separately from the person's note. Adding a review marker refreshes the report and search entry in the background. Damage labels and descriptions have leader lines in video/still review; native video overlays rotate calibrated sensor coordinates only for matching source timestamps. Manual snapshots retain their own source image rather than borrowing another frame's coordinates.

### Visible processing and bounded recovery

The live workspace exposes persisted batch IDs, four worker slots, attempt numbers, source references, source-specific observations and measured object boxes. `batchSummaries` derives display states from those records: queued, checking, retrying, findings, clear, failed or unassessed. Only batches where every source succeeded without warnings can be clear. The UI loads source images through the authenticated session media route; no credential is placed in the image URL. A clear card dissolves its source thumbnail into a checkmark, with reduced-motion support. RoomPlan object IDs drive the icon list and tally; view-level boxes never increment a distinct-object count on their own.

The expandable workflow follows saved state for source preservation, frame checks, the room report, optional check-in comparison and search indexing. Transfer completion and final acknowledgement are separate. Saved sessions continue polling while background report/search stages are active; terminal failures remain visible. A worker that has been processing a saved inspection for more than six minutes is marked partial, retaining its sources and marking unfinished frames unassessed.

Temporary AI service errors receive at most three attempts when the request budget allows. Billing/credentials failures stop provider work; rate limiting pauses the queue rather than immediately retrying four calls. Live coordinators renew a lease and recover frames abandoned by an expired coordinator. The live retry endpoint requeues retryable failed source frames within the authorized session. Required source files are never skipped to manufacture a successful save.

Browser chunk uploads retain acknowledged parts for retries in the current page. Finalization recovers lost acknowledgements through an authenticated status endpoint, which also releases stale finalization leases. Active finalizations heartbeat their lease; abandoned ones become recoverable after one minute. The native app retries transient chunk and finalization failures up to three times and retains its manifest/source files when recovery fails. The new native behavior requires an updated iOS build. Background transfer after terminating the app is not implemented by these changes.
