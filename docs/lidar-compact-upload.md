# Compact native LiDAR upload

New scans build a **LiDAR-initialized Gaussian preview** on the iPhone. This is an
unoptimized Gaussian representation of measured depth samples, not the output of
photometric 3DGS training. The viewer labels it accordingly. There may be gaps,
blur, drift and colour seams; it must not be used as proof of surface condition.

## Payload and latency

Previously the default uploaded up to 240 JPEGs, 240 depth maps, 240 confidence
maps and a parametric USDZ, sequentially. Each file uses initialize/chunk/complete
requests. Box dimensions/transforms are only small JSON records.

New captures upload:

- One binary Gaussian PLY, at most 150,000 splats (~8.4 MB plus header).
- At most 24 evenly spaced JPEG samples, resized to a 1280-pixel long edge at
  quality 0.78, with intrinsics scaled to the actual encoded image dimensions.
- Corresponding raw depth/confidence maps, so evidence can still be projected
  into world-space markers.
- The manifest, including measured object transforms/dimensions for association.

At most 73 assets are sent, four concurrently, with sequential chunks within each
asset. Completed references are persisted atomically, including successful peers
of a failed upload. Retry resumes completed assets; partially uploaded files may
restart. No measured upload-time improvement is claimed until a device run.

Full-resolution frames, depth, confidence, USDZ and `original-manifest.json` remain
in the app's Documents capture folder. They are **not backed up to Atlas by the
compact upload**. Export that folder before removing the app or deleting local
captures. The cloud `manifest.json` describes only the selected upload evidence.
Existing completed captures are not rewritten; scan again to use the new path.

## Preview construction

Normal ARKit tracking only; confidence level 2; depths 0.2–6 m; sample every third
depth pixel, excluding horizontal depth jumps. Project using calibrated intrinsics
and ARKit's right/up/back camera convention. RGB comes from the matching YCbCr
camera buffer. Deduplicate on 2.5 cm world voxels, capped at 150k samples (further
new voxels are omitted). Each sample becomes an isotropic Gaussian with bounded
radius, measured colour encoded as DC spherical harmonics and fixed opacity.
No learned detail, inferred hidden surfaces, or random points are added.

The website opens the splat by default. Objects use small anchors; damage uses
its existing world-space coordinates. Bounds are optional and invisible geometry
is retained for picking. With no usable depth, the UI retains measured-geometry
fallback and does not fabricate a splat.

A later trained Gaussian PLY can replace the initialized preview through the
existing reconstruction upload. The preview reference stays in reconstruction
history. Trained reconstructions still require the documented offline workflow.

References: Apple's [scene-depth projection example](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth)
and the installed GaussianSplats3D INRIA PLY loader.
