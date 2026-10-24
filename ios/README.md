# Dwelld Capture

Native SwiftUI / RoomPlan companion for iOS 17+, using actual LiDAR-capable hardware. Open `DwelldCapture.xcodeproj`, choose your Apple signing team and a supported physical device, and build. No extra Swift packages are required.

1. The app defaults to https://dwelld.vercel.app. Sign in in the embedded browser, tap Done, select your owned room and Move-in or Move-out. Start scan works locally without sign-in. Upload creates the owned spatial inspection after you sign in and choose a room. You can also create a room in the app. The advanced address control supports another HTTPS deployment.
2. Start scanning, move slowly through the room, and finish within 120 seconds. Keep overlap between views and avoid moving furniture.
3. The app exports actual RoomPlan element UUIDs, transforms, dimensions and USDZ. It records RGB JPEGs, camera poses and intrinsics at 1 Hz, up to 120 seconds. It also records an upright MP4 targeting 30 FPS. Raw scene depth/confidence are saved when available from the RoomPlan AR session; the completion message reports how many frames have depth. It does not fabricate missing depth.
4. Upload sends each asset through the authenticated 2 MB chunked GridFS media service, then saves the immutable spatial manifest. Alternatively share the local capture folder and import all files on the inspection's Spatial verification page. Retry resumes assets already saved to GridFS. Reposting an identical completed manifest is idempotent.

Matrices are column-major. World coordinates use ARKit's right-handed Y-up frame in metres, local to this scan session. Camera intrinsics correspond to the original unrotated image pixels. Depth is packed row-major float32 metres (little endian); confidence is uint8 0–2. These are sensor observations, not proof a surface is undamaged. Do not compare origins across independent scans without registration.

## Validation

The app compiled successfully for the simulator and for the connected iPhone 16 Pro using the user’s existing Apple account and development signing. Installation/launch and subsequent real capture results are recorded separately. Real capture quality, depth availability and end-to-end native upload still require device verification. Simulators do not produce substitute geometry.

## Local privacy

Capture files are kept in the application's Documents directory. Standalone captures upload when you choose Upload; a paired live inspection also streams preview video, sampled evidence and confirmed manual snapshots during the scan. Export important captures before uninstalling the app. The current capture remains in memory during use; reopening a saved folder after restarting the app is not yet implemented. The companion uses the web account cookie acquired through WKWebView and sends requests only to the configured HTTPS deployment. Do not enter an untrusted host.

The live RoomPlan view occupies at least 320pt and includes live tracking state, calibrated frame count, available depth-frame count and tracked feature-point count. These values are measured from ARKit; the counter does not simulate scan progress. Physical capture still needs verification on the device.

## Website QR pairing

Create a laptop inspection and scan its QR. The HTTPS handoff page offers **Open Dwelld Capture** using the registered `dwelld://pair` scheme, or browser video. The native app redeems the one-use pairing token and uses a session-scoped phone token, without acquiring an account session. It reports real frame/depth counts and sends an upright WebRTC preview targeting 30 FPS independently of the one-photo-per-second AI checks; a small JPEG preview is available as a connection fallback. RoomPlan outlines are native-only during capture. After Finish scan and Upload, the same laptop session links to the saved measured room. Native paired assets carry both owner and live-session metadata; the manifest route validates both. The final upright 30 FPS recording is saved alongside the calibrated source photos. Gaussian training remains an offline step.

## Continuous damage feedback — 24 October 2026

The paired capture selects a steady evidence photo every second, queues frames chronologically, and retains the other evidence photos for the final save. RGB evidence has a maximum 1600-pixel edge; depth/confidence uploads stay sparse. The server checks obvious basic-furniture damage using Argon in batches of up to six timestamped photos. Edge/crack specialist inference is retired. Findings remain pending human review.

The phone shows marked source-photo evidence and projects findings with measured world coordinates into the current camera viewport. The laptop shows the same evidence and 3D markers. The phone progress response reports checked, processing and queued photo counts. These are asynchronous checks, not guaranteed one-result-per-second video inference. Mark damage freezes the exact aimed-at frame and opens an optional note field. Saving sends that snapshot, aim point and note for grounded localization; the scan continues behind the sheet. A new native build is required; web deployment alone does not update an installed iPhone app.
