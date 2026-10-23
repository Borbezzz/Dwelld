#!/usr/bin/env python3
"""Offline reconstruction from real Dwelld ARKit keyframes. Requires COLMAP + CUDA gsplat.
No image synthesis, fabricated poses, random scene initialization or hosted service.
"""
import argparse
import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

GSPLAT_REVISION = "512d366b67073d77ca099ede742683c165dfc23b"

def run(*args, cwd=None):
    subprocess.run([str(a) for a in args], cwd=cwd, check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path, help="Exported folder containing manifest.json and original JPEGs")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--gsplat", type=Path, required=True, help="Installed gsplat source checkout at documented revision")
    parser.add_argument("--steps", type=int, default=7000)
    parser.add_argument("--prepare-only", action="store_true", help="Prepare calibrated COLMAP input; do not train")
    args = parser.parse_args()
    import numpy as np
    from scipy.spatial.transform import Rotation
    if not 100 <= args.steps <= 30000:
        parser.error("steps must be between 100 and 30000")
    capture = args.capture.resolve(); output = args.output.resolve()
    manifest = json.loads((capture / "manifest.json").read_text())
    if manifest.get("coordinateSystem") != "arkit-right-handed-y-up-metres" or not 8 <= len(manifest.get("frames", [])) <= 600:
        raise ValueError("Need 8–600 real calibrated ARKit frames in a supported coordinate system")
    if output.exists():
        raise ValueError("Choose a new output directory; existing reconstructions are never overwritten")
    (output / "images").mkdir(parents=True)
    seed = output / "sparse_seed"; seed.mkdir()
    cameras, images = [], []
    db = sqlite3.connect(output / "database.db")
    # Official COLMAP SQLite schema for cameras/images; feature_extractor creates its remaining tables.
    db.executescript("""CREATE TABLE cameras(camera_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,model INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,params BLOB,prior_focal_length INTEGER NOT NULL);
    CREATE TABLE images(image_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,name TEXT NOT NULL UNIQUE,camera_id INTEGER NOT NULL,prior_qw REAL,prior_qx REAL,prior_qy REAL,prior_qz REAL,prior_tx REAL,prior_ty REAL,prior_tz REAL,CONSTRAINT image_id_check CHECK(image_id >= 0 and image_id < 2147483647),FOREIGN KEY(camera_id) REFERENCES cameras(camera_id));""")
    for index, frame in enumerate(manifest["frames"], 1):
        name = frame["image"]
        if Path(name).name != name or not name.lower().endswith((".jpg", ".jpeg")):
            raise ValueError("Unsafe image path")
        image = capture / name
        if not image.is_file(): raise ValueError(f"Missing original image: {name}")
        shutil.copy2(image, output / "images" / name)
        K = np.array(frame["intrinsics"], dtype=float).reshape(3, 3, order="F")
        c2w = np.array(frame["transform"], dtype=float).reshape(4, 4, order="F")
        if not np.isfinite(K).all() or not np.isfinite(c2w).all() or K[0, 0] <= 0 or K[1, 1] <= 0:
            raise ValueError("Invalid measured camera calibration")
        # ARKit camera: right/up/back. COLMAP camera: right/down/forward.
        # World frame is kept unchanged in metres; only camera basis changes.
        world_to_colmap = np.diag([1., -1., -1., 1.]) @ np.linalg.inv(c2w)
        q_xyzw = Rotation.from_matrix(world_to_colmap[:3, :3]).as_quat()
        q = [q_xyzw[3], *q_xyzw[:3]]; t = world_to_colmap[:3, 3].tolist()
        params = np.array([K[0, 0], K[1, 1], K[0, 2], K[1, 2]], dtype=np.float64)
        width, height = int(frame["width"]), int(frame["height"])
        cameras.append(f"{index} PINHOLE {width} {height} " + " ".join(map(str, params)))
        images.append(f"{index} " + " ".join(map(str, q + t)) + f" {index} {name}\n")
        db.execute("INSERT INTO cameras VALUES (?,?,?,?,?,?)", (index, 1, width, height, params.tobytes(), 1))
        db.execute("INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?,?)", (index, name, index, *q, *t))
    db.commit(); db.close()
    (seed / "cameras.txt").write_text("\n".join(cameras) + "\n")
    (seed / "images.txt").write_text("\n".join(images) + "\n")
    (seed / "points3D.txt").write_text("")
    shutil.copy2(capture / "manifest.json", output / "capture-manifest.json")
    if args.prepare_only:
        print("Prepared measured camera poses and original images. No reconstruction trained.")
        return
    import torch
    if not torch.cuda.is_available(): raise RuntimeError("CUDA GPU unavailable. Dataset prepared, but gsplat training was not run.")
    if not shutil.which("colmap"): raise RuntimeError("Install COLMAP on the offline reconstruction machine")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.gsplat, text=True).strip()
    if revision != GSPLAT_REVISION: raise ValueError("gsplat checkout differs from the documented tested API revision")
    run("colmap", "feature_extractor", "--database_path", output / "database.db", "--image_path", output / "images", "--ImageReader.existing_camera_id", "-1")
    run("colmap", "sequential_matcher", "--database_path", output / "database.db")
    sparse = output / "sparse" / "0"; sparse.mkdir(parents=True)
    run("colmap", "point_triangulator", "--database_path", output / "database.db", "--image_path", output / "images", "--input_path", seed, "--output_path", sparse, "--Mapper.ba_refine_focal_length", "0", "--Mapper.ba_refine_principal_point", "0", "--Mapper.ba_refine_extra_params", "0")
    trainer = args.gsplat.resolve() / "examples" / "simple_trainer.py"
    import sys
    run(sys.executable, trainer, "default", "--data-dir", output, "--data-factor", "1", "--result-dir", output / "trained", "--max-steps", args.steps, "--ply-steps", args.steps, "--save-ply", "--disable-viewer", "--disable-video", "--no-normalize-world-space", cwd=trainer.parent)
    ply_files = sorted((output / "trained").rglob("*.ply"), key=lambda p: p.stat().st_mtime)
    if not ply_files: raise RuntimeError("Trainer completed without a Gaussian PLY; no successful reconstruction claimed")
    shutil.copy2(ply_files[-1], output / "reconstruction.ply")
    registration = {"sessionId": manifest["sessionId"], "source": "arkit-calibrated", "transform": np.eye(4).flatten(order="F").tolist(), "gsplatRevision": revision, "notes": "Known ARKit camera poses; COLMAP triangulation; normalization disabled. Verify visual alignment before confirming spatial evidence."}
    (output / "registration.json").write_text(json.dumps(registration, indent=2))
    print("Trained reconstruction.ply and registration.json saved. Check alignment in Spatial verification.")

if __name__ == "__main__": main()
