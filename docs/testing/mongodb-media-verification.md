# MongoDB-only media verification

Date: 2026-10-23. Local application: `http://localhost:3001`.

## Real storage and chunked HTTP upload

These checks used the configured MongoDB database and real GridFS writes. Credentials were loaded from local environment files and were not printed.

- A small text fixture was written using `writeMedia`, retrieved using `readMedia`, and compared byte-for-byte.
- Streaming media response returned the complete content with status 200.
- A byte range returned status 206 and the exact requested bytes; a suffix range returned the expected tail.
- An out-of-bounds range returned status 416.
- A 5 MiB + 173 byte non-sensitive binary fixture was uploaded through `/api/uploads` in three requests, each at most 2 MiB. Its MIME label was `video/mp4` solely to exercise the video upload interface; this fixture was not a playable video and was not used as an inference test.
- Uploading part 1 before part 0 returned 409.
- Completing an incomplete upload returned 409.
- Accepted part requests returned 200; repeating identical bytes returned 200; attempting to replace an accepted part with different bytes returned 409.
- Completion returned 201 with a `gridfs:` reference. The downloaded GridFS bytes exactly matched the original fixture.
- Repeating completion returned 200 and the same reference.
- Temporary part documents were removed after completion.
- Both verification files and the upload session fixture were deleted after checks. Other application records were untouched.

## Storage behavior

Temporary upload sessions and part documents expire after 24 hours via MongoDB TTL indexes. Finalization checks part sequence, exact sizes, and SHA-256 digests while streaming into GridFS. Media reads stream through the application with private/no-store cache headers and HTTP byte-range support. These checks demonstrate local API and MongoDB integration; they do not establish deployed Vercel end-to-end behavior.

## Browser workflow and provider failure

The actual browser created `MongoDB pipeline demo`, decoded a three-second MP4 built from the public COCO furnished-room image, ran real YOLO inference (seven objects on each of three sampled frames), uploaded the video through the new chunk API, and created an inspection. The first analysis attempt failed during Gemini processing. A real single-frame reproduction returned HTTP 504 `DEADLINE_EXCEEDED`; this was not a MongoDB authentication or storage error. The original video stayed attached to the failed record. Its application video endpoint returned byte-for-byte matching source data and a correct 206 byte-range response.

The fixture is a static image encoded as video, not a moving-room walkthrough. Full camera/WebM and deployed Vercel checks remain separate requirements.

## Completed browser-to-database inspection

A repeat test used an 11.2 MiB lossless three-second MP4 made from the same public room photo. The normal browser UI ran YOLO, uploaded the video in six chunks, created the inspection and displayed saved GridFS evidence. Exact extracted-frame hashes eliminated the repeated still frames. Real Gemini analysis completed in approximately 144 seconds with no warnings: seven YOLO object detections plus one supplementary sideboard observation, and zero damage observations. This is a successful real-service static-video fixture workflow, not an accuracy benchmark or proof of moving-room coverage.

The browser selected and confirmed a chair, then reloaded the inspection. The eight object boxes and one confirmed review persisted. Direct MongoDB inspection confirmed one review-history entry. Original video bytes matched the upload exactly; the evidence route returned HTTP 200 PNG. Machine-readable results are in `mongodb-inspection-result.json`. The clearly named demo room and successful inspection are retained for review.

The earlier timeout led to bounded transient retries and explicit `partial` results with safe warnings. A failed check never becomes an “undamaged” claim. Fourteen automated tests cover parser, geometry, media extraction and partial-analysis behavior. TypeScript passes. Production build is checked separately at completion.

Remaining limits: no deployed Vercel verification, no actual moving walkthrough/camera/WebM test, no cross-view physical object identity, and no tenant authentication. An abrupt process termination can leave orphan GridFS chunks; caught upload failures clean up, while temporary upload documents expire. Semantic/hybrid search is not implemented (see `../search-investigation.md`). The controlled static-fixture demo is verified; a live judge recording should be rehearsed before relying on it.
