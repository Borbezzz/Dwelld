# Encode London 2026: Dwelld submission and performance check

Checked against the published Encode London 2026 programme on 24 October. Source: https://www.encodeclub.com/programmes/encode-london-2026

## Important rules
- Event: 23–25 October 2026. Submission closes Sunday 25 October, 12:00 London time.
- **Google DeepMind / Gemini 4 Argon:** GitHub repository, 3-minute demo video, live 3-minute demo + 2-minute Q&A, disclose models/agents and how they were used. Working live demo 50%, problem 25%, originality/need for Argon 15%, clarity 10%. Work built before kickoff is specifically called out as ineligible; demonstrate only code authored during the hackathon. Verify commit timestamps and eligibility with organisers; do not claim the whole repo is new if it is not.
- **MongoDB:** Atlas must be foundational backend and at least one of Atlas Search, Atlas Vector Search, Hybrid Search, Automated Embedding, Atlas Stream Processing, Voyage AI. Repository and 3-minute app demo showing MongoDB in use.
- **Open 'Real World' track:** working demo, repository with setup README, 2–4-minute video using real inputs, note on models and sources, explain uncertain detections/privacy.
- **Saint bounty** is separate and requires actual Saint runtime use and 2–4-minute end-to-end demo; Dwelld does not currently qualify on the basis of Atlas/Gemini integrations alone.

## Code-based partner audit (not proof that deployed services are configured)
- Atlas foundation: YES in source: rooms, inspections, findings, spatialCaptures, spatialMarkers, Better Auth and media GridFS.
- Atlas Search: IMPLEMENTED in source, operational only when deployment indexes are ready.
- Vector Search + hybrid RRF: IMPLEMENTED in `lib/server/search.ts`, requiring search indexes and populated Gemini embeddings. Verify live endpoint against actual Atlas account.
- Automated Embedding / Atlas Stream Processing / Voyage AI: NOT VERIFIED IN SOURCE. Do not claim these.
- Gemini 4 Argon: configured via `GEMINI_MODEL=gemini-4-argon` and default in inference/ask code. Verify the live key and chosen model in server logs. `gemini-embedding-001` is also used. Actual model usage is a demo requirement, not satisfied by a string in .env.
- Human verification: markers, inspection review, comparison review and source-cited Ask flow are available in source. Demo a complete real input -> model finding -> correction/confirmation -> stored evidence -> answer/report cycle.
- Saint: no integration verified; only enter this bounty after actually integrating it.
- Demo/video and submission: cannot be established from the source repo. Prepare before noon on 25 October. Never expose API keys or private tenant captures.

## 3-minute demo suggestion
0:00 renter's problem and consent to record; 0:20 create room, pair LiDAR phone or upload real video; 0:45 live scan/inference with Gemini model visible in logs; 1:20 measured geometry appears first, optional splat separately; 1:40 correct/add/reject damage marker; 2:05 Atlas documents plus text/vector hybrid search and source-cited question; 2:35 export / compare; 2:50 disclose model versions, limitations and partner services.
Use a known small capture and preload credentials; do not imply a missing detection proves there is no damage.

## Performance architecture and remaining work
Browser dashboard -> spatial manifest GET -> measured geometry in Three.js or dynamic Gaussian viewer -> authenticated asset GET -> GridFS byte ranges. Native RoomPlan/ARKit generates manifest and optional LiDAR splat; optional offline gsplat/COLMAP produces a trained PLY. Server's spatial GET sends a full manifest and markers; GridFS responses are private/no-store by design.

Implemented in this branch:
1. Dashboard scans for first useful capture in parallel batches of three rather than a serial network waterfall.
2. Spatial workspace fetches capture and inspection metadata concurrently.
3. Compact dashboard viewer starts with measured geometry and avoids downloading/decoding the large PLY. Full inspection viewer still offers room splat and geometry toggle.

Important next steps, requiring benchmark captures before changing formats:
- Measure network waterfall (spatial GET TTFB, PLY transfer MB, addSplatScene parse/sort time, first rendered frame, WebGL memory); compare cold/warm and mobile/desktop.
- Add a lightweight, server-owned latest-spatial-capture lookup or denormalized room preview pointer to eliminate dashboard probing altogether, with auth, indexing and updates on imports.
- Generate tiered, validated small preview splats and progressive LOD for the full viewer. Do not silently truncate binary PLY, lose registration transforms or expose media URLs.
- Keep GridFS assets private. Consider versioned *authenticated* session-side reuse, conditional ETags and byte-range-compatible caching only after privacy review; current no-store prevents repeat caching.
- Virtualize or defer offscreen dashboard scenes; stop rendering while hidden; benchmark DPR and sorting modes on real devices.
- Avoid blocking capture UI on offline trained reconstruction. Run inference as a durable, observable job before claiming reliability; current Next.js after() is tied to function lifetime.
- Run `npm ci && npm run lint && npm test && npm run build` and live capture/render tests in a real deployment. Connector edits here were not locally executed.
