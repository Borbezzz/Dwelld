# ONNX Runtime Web assets

These files are copied unchanged from the installed `onnxruntime-web` package's `dist/` directory. Version is pinned by package-lock.json. MIT license is in LICENSE.txt. They provide the single-threaded WASM execution backend without external CDN requests or cross-origin isolation headers.

After upgrading onnxruntime-web, copy the matching `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.mjs` from that exact installed package into this directory. Runtime JS and WASM versions must match.
