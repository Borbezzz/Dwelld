# Vision inspection pipeline audit — 24 October 2026

The latest remote recorded-frame marking, evidence seals and AI diagnostics are preserved. Recorded-frame notes also reach localization and are saved as `userNote`.

This audit distinguishes existing functionality from the gaps filled in this change. It does not claim that a new native build has been installed or tested in a real phone-to-laptop session.

| Plan item | Already implemented | Missing work completed |
| --- | --- | --- |
| 3D selection → source evidence | Gaussian/RoomPlan element selection, finding association, exact timestamp seeking, upright photo review, native 30 FPS recording/playback, snapshot-grounded Gemini boxes | Red appearance intervals on the video scrubber, calculated from calibrated source poses; saved intervals plus fallback calculation for existing captures, clipped across continued recordings |
| Transfer latency | WebRTC preview targeting 30 FPS, independent sampled evidence, bounded uploads, GridFS, asset resume | Three concurrent browser chunks and two native chunks per asset; byte-identical part retries; cached index initialization instead of repeated per-frame index work |
| Human verification and scan chat | Exact manual snapshots, aim point, review history, confirm/dismiss, browser note control | Native snapshot preview with optional 1,000-character note; note passed to localization and persisted; current-scan multimodal Argon chat with citations, selected-finding context, persisted conversation, access checks and retry IDs |
| Argon damage analysis at 1 FPS | Native and uploaded-video sampling, chronological six-frame batches, strict prompt/output validation | Removed active crack segmentation and edge/depth screening calls, removed crack model deployment tracing; browser sampling now independent of YOLO latency; save waits for analysis or explicitly records provider-blocked coverage as partial |
| MongoDB and search visualization | Atlas foundational store, GridFS media, review records, keyword/vector/hybrid search implementations, Voyage embeddings and PCA map in the search lab | Created only missing automated embedding/photo-vector indexes; prepared current test account's findings; reused the vector map within ordinary main-page search; added `scanChat` collection indexes and deletion cleanup |

Appearance intervals mean the object's projected bounds are in view in sampled camera poses. They are not pixel-level occlusion tracking, nor proof that damage is visible throughout the interval. Gaps split the interval. Bounding boxes remain tied to their own snapshot; they are not copied across moving video frames. Existing photo-only captures cannot be converted into genuine 30 FPS footage. New native captures store an actual video independently of the 1 FPS analysis photos.

MongoDB documents now retain optional `userNote` and `visibilityIntervals` fields; existing documents remain readable without a destructive migration. Scan chat has owner/context/time indexes and an idempotent request index.

## Backend prompt and output

`lib/server/damage.ts` contains `FURNITURE_DAMAGE_PROMPT` and `inspectVideoDamageBatch`. The prompt is already implemented: obvious damage on chairs, sofas, bed frames, tables/desks and storage furniture only; ignore texture, seams, shadows, dust and minute blemishes; no hidden defects, liability or invented confidence. Adjacent frames provide context, but each box must be supported by its own source image. Walls/floors/doors and appliances are outside this automatic furniture pass; manual marks can target other surfaces.

The default model is `gemini-4-argon`, with an optional `GEMINI_MODEL` override. Damage and scan-chat requests explicitly set SDK `thinkingConfig.thinkingLevel` to `MEDIUM`, without sampling overrides or `thinkingBudget`.

```json
{"frames":[{"timestampSeconds":1.2,"damage":[{"type":"scratch","description":"Visible scratch on the table edge","boundingBox":{"x":0.3,"y":0.4,"width":0.1,"height":0.05}}]}]}
```

This example illustrates the contract, not a finding. Every input timestamp must appear exactly once. No visible damage returns `damage: []`; ambiguous localization returns `boundingBox: null`. Boxes must be finite normalized coordinates within their own image. Manual localization receives the exact marked snapshot, close-up, aim point and separately labeled untrusted note; it rejects undamaged/off-target boxes. Human review remains required.

## MongoDB requirements and verified deployment state

The reference checklist is [BOUNTY-REQUIREMENTS.md](BOUNTY-REQUIREMENTS.md). It requires Atlas as the core store and **at least one** listed advanced feature; it does not require all six.

- Atlas core storage: users, rooms, inspections, findings, source media in GridFS, calibrated captures, review history, live sessions and now scan conversations.
- Four indexes verified `READY`: `findings_search`, `findings_auto`, `findings_image`, `findings_vector`.
- Current test account: three persisted manual report-layout fixtures on a real photo, explicitly labeled as test data, now with search text and three Voyage photo vectors. These are not AI-detected defects.
- Verified authenticated UI queries: Atlas automated embedding (`voyage-4`), photo vector search (`voyage-multimodal-3.5`), native `$rankFusion` hybrid results and Voyage reranking. The PCA map uses existing embeddings and displays the query position; it is a projection for exploration, not physical room geometry or proof of damage.
- Gemini text embeddings remain absent for that account. Live Argon chat returned a provider billing/spending-limit error. No successful live Argon reasoning is claimed; the configured account must resolve the provider limit before a full AI demo can pass. Search still works through Atlas automated embeddings and Voyage.
- Atlas Stream Processing is not implemented and is not claimed. WebRTC streaming is not Atlas Stream Processing. The minimum advanced-feature requirement is satisfied by the verified search features.
- Submission description, repository link and three-minute demo showing MongoDB in use must still be submitted by the team. A successful code build does not complete a submission checklist.

## Validation

162 automated tests pass, including source/pose binding, note forwarding, unsupported-citation rejection, denied scan access, independent one-second browser sampling, byte-exact concurrent retries, visibility interval clipping, and retired detector regression checks. TypeScript and the production Next.js build pass. The unsigned iOS device build passes. Physical-device installation, sustained 30 FPS/network behavior and real-scene damage accuracy still require a new native build on the phone; the provider block also prevents a complete live AI verification.

## Native batch concurrency update

Native live and saved analysis now run up to two six-frame Argon batches concurrently, matching the existing uploaded-video concurrency. The live coordinator claims each photo once and commits batch results in timestamp order, so reversed model completion cannot race deduplication. Saved analysis sorts observations before final deduplication. All 1 FPS samples and source evidence remain; this is concurrency within the existing requests, not the offline Gemini Batch API. Rate limits pause new work with a live cooldown; billing blocks stop further waves while retaining queued photos and usable in-flight results. This change preserves the existing same-element/type/12 cm duplicate rule. Stronger object-relative identity and multiple sightings per defect remain a separate proposed enhancement.
