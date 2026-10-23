# Pretrained crack specialist

- Repository: https://huggingface.co/beaunix/smart-crack-vision
- Revision: `9442007ef9c1003880baa5796d253608691b37c4`
- Source filename: `crack_detection_model.onnx`
- Local filename: `crack-seg.onnx`
- SHA-256: `4b789658646d790079d3e78d9d3ed475030d740a4b8412aff52248189a114cbd`
- Architecture: Ultralytics YOLOv8n-seg, input 1×3×640×640. Output 1×37×8400 (one crack class plus mask coefficients) and 1×32×160×160 mask prototypes.
- License: AGPL-3.0, including network-use source obligations. See the bundled ULTRALYTICS-LICENSE.txt and upstream model card. The model card reports public-domain crack training data; this is the publisher's statement, not a separate dataset audit. No proprietary/enterprise licence has been acquired.

Dwelld uses its crack bounding-box candidates, not the segmentation mask or a structural severity score. It does not detect stains, dents, scratches, or all household materials. Gemini supplies broader multimodal damage observations. Shadows, joints and textures can cause false positives; all candidates require human review. Results cannot certify safety or declare a room damage-free.

Preprocessing uses RGB, 640px centered letterbox (114 background), float32 CHW /255. Confidence threshold .45, NMS IoU .45, maximum8 candidates. Bounding boxes are restored to normalized source coordinates. The server verifies the pinned checksum before CPU inference. No separate GPU service is used.

High-resolution evidence now runs as a full view plus four overlapping 60% crops (when the longer image dimension is at least 960px). Crop coordinates map back to the preserved source; final IoU suppression is .35, maximum 12 candidates. Live inference runs concurrently with Gemini and preserves independent failure warnings. This remains one specialised crack model, not additional trained damage categories.
