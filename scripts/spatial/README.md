# Offline Gaussian reconstruction

This workflow trains actual Gaussian splats from the native app's original calibrated room images. It does not run a GPU service, train on Vercel, invent geometry, or treat RoomPlan USDZ as a photorealistic reconstruction.

## Install on your own CUDA workstation

Use a dedicated Python environment with CUDA-compatible PyTorch, NumPy, SciPy and COLMAP. Clone [gsplat](https://github.com/nerfstudio-project/gsplat) and check out revision `512d366b67073d77ca099ede742683c165dfc23b`. Install gsplat and its `examples/requirements.txt` according to the repository instructions. The wrapper deliberately refuses an unreviewed revision for training. Dependency wheels and GPU compatibility depend on that machine.

```sh
git clone https://github.com/nerfstudio-project/gsplat.git
git -C gsplat checkout 512d366b67073d77ca099ede742683c165dfc23b
python -m pip install -e ./gsplat
python -m pip install -r ./gsplat/examples/requirements.txt
python scripts/spatial/reconstruct.py /path/to/exported-capture --output /path/to/new-output --gsplat /path/to/gsplat --steps 7000
```

Use `--prepare-only` to validate input and prepare the COLMAP database/camera model without training. At least eight real frames are required. Dense overlapping imagery is essential; no amount of training establishes unseen surfaces.

The wrapper preserves ARKit's measured world frame: transforms the **camera basis** into COLMAP convention, triangulates correspondences using the measured poses, and disables gsplat world normalization. The resulting `reconstruction.ply` is accompanied by `registration.json`. Import both in Spatial verification to overlay geometry and markers; inspect alignment before relying on it. If pose drift or triangulation produces poor geometry, do not accept the registration merely because its transform is identity. Independently trained PLYs without calibration remain explicitly unregistered.

## Licensing

[gsplat uses Apache-2.0](https://github.com/nerfstudio-project/gsplat/blob/main/LICENSE); retain applicable license/NOTICE materials when distributing it or modified code. [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) and Three.js use MIT. Their license notices are in the installed packages. COLMAP uses a BSD license, with dependencies carrying their own terms. The original INRIA Gaussian-splatting implementation has different licensing: this workflow does not vendor or invoke that trainer. YOLO's existing AGPL restrictions remain independent.

## Verified versus blocked

Wrapper syntax, manifest validation and native simulator compilation can be checked locally. This Mac has no CUDA GPU and no live LiDAR room capture was available, so COLMAP triangulation, gsplat training and visual accuracy have **not** passed real reconstruction testing. Do not claim a trained scene or judge-ready native capture until a real room has completed this workflow.
