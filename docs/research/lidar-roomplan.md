# LiDAR and spatial inventory feasibility

Researched 23 October 2026. This is a proposal, not a completed native capture feature. Current Dwelld uses camera images and short-lived 2D tracks; it has no measured room coordinates.

## Recommended next experiment

Build a small native Swift companion on a supported LiDAR iPhone or iPad. Capture RoomPlan structural geometry and furniture transforms alongside ARKit camera poses. Upload the real capture and a JSON spatial manifest to the existing MongoDB/GridFS backend. Associate image observations with spatial anchors, keeping uncertain matches reviewable. This is the most direct path to improving object identity after camera movement.

Apple documents RoomPlan as a Swift API using camera and LiDAR to identify room surfaces and furniture and export a parametric USD/USDZ representation. This supplies geometry, not detailed damage evidence or guaranteed furniture identity across independent scans. Preserve the original photographs/video separately. [Apple RoomPlan](https://developer.apple.com/augmented-reality/roomplan/)

## Capability boundary

| Capability | Implementation path | Current Dwelld status |
|---|---|---|
| RGB camera, YOLO boxes, short-term tracking | Browser camera frames + ONNX | Implemented; camera testing required |
| Room geometry and furniture transforms | Native Swift RoomPlan | Research only |
| Depth, camera pose, coloured point cloud | Native ARKit frame data + calibration | Research only |
| View exported USDZ | Safari AR Quick Look | Future integration |
| Desktop spatial inventory | Render real exported dimensions/transforms in web viewer | Future integration |
| Photorealistic novel views | Multi-view reconstruction and Gaussian-splat training | Separate experimental pipeline |

There is no verified Safari API here for direct RoomPlan or raw iPhone LiDAR capture. Do not present WebXR support as access to those native APIs. WebKit's documented immersive WebXR support concerns visionOS rendering; it does not establish iPhone RoomPlan/depth access. A web-based viewer and native capture are separate components. [WebKit WebXR](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/)

## Native capture design

1. Check `RoomCaptureSession.isSupported` and ARKit frame-semantics support on the actual device; explain unsupported hardware.
2. Run `RoomCaptureView`/`RoomCaptureSession`, preserve the scan coordinate system, and collect furniture dimensions/transforms plus captured room identifiers.
3. For richer spatial evidence, record camera transforms, intrinsics, RGB timestamps and LiDAR depth/confidence. Align observations by timestamp and project depth points using the camera calibration. Apple provides a real depth point-cloud sample; upsampling depth does not create additional measured detail. [Apple depth sample](https://developer.apple.com/documentation/ARKit/displaying-a-point-cloud-using-scene-depth)
4. Link YOLO box observations to candidate spatial furniture anchors using projected geometry, category compatibility and time. Require review for ambiguous same-class objects, occlusion, relocalization or moved furniture. Persist an explicit coordinate-system/session ID.
5. Save geometry JSON as ordinary MongoDB records and large USDZ/depth assets in GridFS. Keep spatial associations separate from confirmed damage evidence and retain review history.

RoomPlan can merge rooms when capture sessions preserve the AR session; arbitrary independent scans should not be assumed to share one origin. [Apple multi-room capture](https://developer.apple.com/documentation/roomplan/scanning-the-rooms-of-a-single-structure)

## Web export and viewing

Use a real capture's USDZ for an iOS Quick Look link, or convert actual captured geometry to a web-friendly mesh. For an initial 2D floor-plan view, project captured walls and furniture transforms onto the floor plane; label incomplete or uncertain geometry. Do not infer a measured map from current image-space boxes. Safari can display supplied USDZ content via Quick Look; viewing does not provide the website with a raw room scan. [Apple Quick Look](https://developer.apple.com/quick-look-gallery/)

## Gaussian splatting

The original technique trains a scene representation from calibrated multi-view images and sparse points and renders new views. It is not a direct consequence of having a RoomPlan USDZ file, nor does a rendered splat guarantee accurate physical dimensions or stable inventory identities. Plan capture coverage, pose estimation, compute, asset size and licensing separately. Prioritize measured spatial anchors and room geometry first; add a splat viewer only after a reconstruction from real room imagery exists. [Original research project](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)

No native prototype or scan was available in this environment. Real hardware validation, native signing and capture permissions remain required. No synthetic room model is presented as a scan.
