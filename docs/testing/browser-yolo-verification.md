# Hybrid pipeline verification — 23 October 2026

Real ONNX Runtime Web WASM inference ran in the browser against public COCO room photographs. The kitchen image returned two ovens. The furnished-room image returned two chairs, two TVs, a potted plant, a vase and a clock. It missed the visible dining table; the second TV may be a false positive. Source URLs, scores and model provenance are recorded in `public/models/README.md`.

Actual Gemini 4 Argon requests used full-resolution object crops derived from these detections. Both oven crops and a chair crop returned no damage. A separate kitchen surface pass reported a potential wall stain, requiring human review. Raw structured results are in `hybrid-image-inference.json` and `chair-damage-inference.json`.

A three-second MP4 generated from the furnished-room photograph exercised browser video decoding, frame sampling and real ONNX inference at approximately 0.45, 1.50 and 2.55 seconds. Each sample returned seven detections. This static photograph clip is not a real walkthrough or an accuracy benchmark.

Live MongoDB/API checks verified manual damage-marker creation with an exact parent object link, persisted coordinates when reopening the inspection, and HTTP 400 rejection for an out-of-range coordinate. Temporary records were removed.

The complete private Blob upload, original-video extraction, Gemini analysis and persisted evidence-delivery flow remains unverified because `BLOB_READ_WRITE_TOKEN` is missing. Browser camera/WebM capture has not received an end-to-end test. Identical extracted frames are skipped, but physical object identity across moving camera views is not resolved. Large jobs may exceed the deployment's function duration limit.

The shipped Ultralytics model uses AGPL-3.0 or separately purchased Enterprise terms. Review those obligations before proprietary distribution; the application's license has not been changed. ONNX Runtime Web uses MIT terms.
