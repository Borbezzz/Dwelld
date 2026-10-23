# Spatial verification status

23 October 2026.

Implemented real native RoomPlan capture source, calibrated RGB/pose exports and optional available depth/confidence, USDZ, authenticated chunked GridFS uploads, immutable scan import, world markers and Gaussian PLY rendering. Imported Gaussian splats use explicit same-session rigid calibration for measured geometry/marker overlays; unregistered reconstructions show no misleading overlays. Finding links validate ownership and remain human associations.

## Passed

- Swift iOS simulator build.
- Signed iPhone 16 Pro device build and installation after selecting the existing Apple account and registering the connected device for provisioning. Local strict signature verification, profile expiry and device inclusion checks passed. Initial launch was denied pending iOS trust; no security settings were changed automatically.
- TypeScript checks after web implementation.
- Three deterministic spatial validator tests: rigid transforms, non-reflection, planar zero thickness, sanitized object schema, duplicate IDs and registration session matching.
- Real authenticated local API + MongoDB integration: manifest import, marker add/move/confirm/delete, persistence/reload, version conflict rejection, review history and unauthenticated denial. The geometry in this API test was explicitly a **synthetic test fixture**, not a LiDAR scan; all fixture documents were removed afterward.
- Python reconstruction wrapper syntax compilation.

## Hardware/reconstruction boundary

Device signing/build is not evidence that a room was successfully scanned or uploaded. Native room quality, depth availability and calibrated image alignment require a real device walkthrough. The gsplat workflow is executable offline code using original frames and known ARKit poses, but CUDA training and output accuracy have not been verified on this Mac. No synthetic room is presented as a successful reconstruction.

Three.js and GaussianSplats3D are loaded only for the spatial workspace. Geometry and markers are stored in ARKit right-handed Y-up metres. Different scan session origins are never automatically equated.
