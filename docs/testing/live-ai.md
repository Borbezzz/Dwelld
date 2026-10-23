# Live AI implementation and verification

## Runtime behavior

`startLiveDetection(video, options)` uses the existing YOLO11n model. It snapshots the actual decoded video source before inference, reports normalized source-frame boxes, and measures actual end-to-end inference/signature latency. The requested cadence is clamped to 2–5 FPS (default 3), but slow devices run at their achievable rate. A module-level lock prevents overlapping inference during camera stop/restart. No frames are queued.

`LiveTracker` greedily assigns one-to-one matches using same-class bounding-box overlap and cropped RGB histograms. Tracks expire after 2.5 seconds without a detection. IDs remain stable for nearby observations; leaving the view, occlusion, camera pans, identical furniture and scene changes can create new IDs or ambiguous matches. This is not a guarantee of room-wide unique inventory.

Evidence capture uses the exact frame that produced detections, capped to 1600 pixels on its longest edge and 1.5 MiB JPEG for the API request. Coordinates stay normalized. The original recorded footage is a separate evidence asset. Preview rendering must use the source aspect ratio, `object-fit: contain`, and the same non-mirrored coordinate system on both devices.

`analyzeLiveFrame` validates up to three supported object boxes, optionally inspects surfaces, stores the selected image in GridFS, and invokes the existing Gemini damage functions. It returns preserved source dimensions, frame reference, timestamp, analyzed object IDs, and unconfirmed potential damage. Null boxes mean localization is uncertain; no confidence scores are invented. The authenticated API owns durable rate limiting and idempotency; the phone UI must keep at most one pending damage request and throttle submissions.

## Checks on 23 October 2026

- Three tracker unit tests pass: stable separate chairs when detector order changes; expiry/re-entry; one-to-one matching and distinct classes. These are synthetic geometry tests, not real camera accuracy tests.
- Real `analyzeLiveFrame` request used the existing real COCO room image and a previously observed YOLO chair box. Gemini inspected the chair and room surfaces, returning an empty damage list. GridFS upload, exact retrieval and cleanup passed. Result details: `live-analysis-verification.json`.
- The first Gemini call failed with an API error; one retry passed. This test does not establish guaranteed provider availability.
- Actual phone/laptop camera transmission, achievable mobile FPS, orientation changes and different-network WebRTC remain separate integration checks. A still-image fixture is not live camera acceptance evidence.
