# Gemini supplementary furniture observations — 23 October 2026

This is a best-effort supplement to real YOLO11n inference, not an expansion of YOLO's COCO classes. Supported supplementary labels: wardrobe, bookshelf, desk, chest of drawers, sideboard, nightstand. Findings carry `detectionSource: gemini` and require review.

The service uses the original full-resolution frame, at most one supplementary detection request and four object crops per selected frame. Normalized top-left x/y/width/height coordinates are validated. Invalid individual observations are discarded, never coerced into guessed locations. A failed supplementary detection request is nonfatal and produces a credential-free server warning; this limitation is not currently surfaced in the UI. Same-frame hypotheses with IoU >= 0.5 against YOLO or an earlier supplementary observation are suppressed.

## Real service evidence

Called configured Gemini 4 Argon with the actual public COCO room photo `val2017/000000000139.jpg` used in the earlier browser YOLO test. One response located a sideboard at `{x:0,y:0.614,width:0.339,height:0.193}` and described a low media cabinet supporting a television. Other calls returned unusable category/coordinates, and the final call with an existing chair exclusion box yielded zero accepted observations. This variability is a model limitation. No mocked detections were used. A successful API call does not establish comprehensive or accurate furniture inventory.

Inline parser assertions passed: valid allowlisted category, invalid category/coordinates discarded, same-frame overlap suppressed, duplicate hypotheses suppressed, more than four observations rejected. TypeScript passed after implementation.

## Coverage and identity limits

Three video frames remain the current bounded sample. They are insufficient to establish coverage of every room surface, especially a long or fast walkthrough. The application must not declare unseen surfaces undamaged. Increasing frame count multiplies provider requests; current maximum is 20 YOLO crops plus 4 supplementary crops and 2 full-frame calls per sampled frame. Large scenes can still exceed the server function deadline.

Exact duplicate extracted frames are skipped by SHA-256. Objects observed from different camera positions are not automatically assigned a shared physical identity. Inventory counts may include repeated views. Neither bounding-box overlap nor model labels establish cross-view identity.
