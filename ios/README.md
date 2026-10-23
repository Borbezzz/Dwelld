# Dwelld Capture

Native SwiftUI / RoomPlan companion for iOS 17+, using actual LiDAR-capable hardware. Open `DwelldCapture.xcodeproj`, choose your Apple signing team and a supported physical device, and build. No extra Swift packages are required.

1. The app defaults to https://dwelld.vercel.app. Sign in in the embedded browser, tap Done, select your owned room and Move-in or Move-out. Start scan creates a new spatial inspection. The advanced address control supports another HTTPS deployment.
2. Start scanning, move slowly through the room, and finish within 120 seconds. Keep overlap between views and avoid moving furniture.
3. The app exports actual RoomPlan element UUIDs, transforms, dimensions and USDZ. It records RGB JPEGs, camera poses and intrinsics at up to 2 Hz, up to 240 frames. Raw scene depth/confidence are saved when available from the RoomPlan AR session; the completion message reports how many frames have depth. It does not fabricate missing depth.
4. Upload sends each asset through the authenticated 2 MB chunked GridFS media service, then saves the immutable spatial manifest. Alternatively share the local capture folder and import all files on the inspection's Spatial verification page. Retry failures may leave owned unreferenced media; no fake successful capture is reported.

Matrices are column-major. World coordinates use ARKit's right-handed Y-up frame in metres, local to this scan session. Camera intrinsics correspond to the original unrotated image pixels. Depth is packed row-major float32 metres (little endian); confidence is uint8 0–2. These are sensor observations, not proof a surface is undamaged. Do not compare origins across independent scans without registration.

## Validation

The app compiled successfully for the simulator and for the connected iPhone 16 Pro using the user’s existing Apple account and development signing. Installation/launch and subsequent real capture results are recorded separately. Real capture quality, depth availability and end-to-end native upload still require device verification. Simulators do not produce substitute geometry.

## Local privacy

Capture files are kept in the application's temporary directory and only sent after Upload is chosen. OS cleanup can remove temporary files; export important captures promptly. The companion uses the web account cookie acquired through WKWebView and sends requests only to the configured HTTPS deployment. Do not enter an untrusted host.
