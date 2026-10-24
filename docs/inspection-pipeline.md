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
Native live observations select their exact source photo in the primary camera pane, with a
return-to-live control. Saved captures expose a prominent next/review action independently
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
