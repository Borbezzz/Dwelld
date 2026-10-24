# Source audit (24 October 2026)

Scope: current GitHub main source tree and selected critical paths. This is a static audit, not an end-to-end certification. No local clone/npm install was possible in this runtime; production credentials, native hardware, and deployed browser timings were unavailable.

## Small fixes in this branch
- Dashboard checks spatial captures from processing inspections too: native capture may already be saved while AI analysis still runs.
- Spatial GET loads capture/markers concurrently, projects only fields consumed by the API.
- Manual spatial import builds a filename lookup once, avoiding a repeated full FileList scan per asset. Upload order and validation remain unchanged.

## Priority findings / recommended follow-ups
1. **Splat viewer teardown on data changes:** `components/spatial-viewer.tsx` rebuilds its entire WebGL scene when `markers` changes because its main effect depends on markers. Marker mutations call workspace `load()`, triggering a potentially costly splat asset reload. Separate immutable geometry/splat lifetime from lightweight marker overlay updates; test cleanup and memory leaks on navigation.
2. **Dashboard preview lookup:** `components/room-reconstruction.tsx` still probes inspections in batches to locate a capture. Add an owner-filtered room/latest-capture endpoint, backed by an index, rather than one HTTP request per candidate.
3. **Sequential upload / processing:** `components/spatial-workspace.tsx` manual import uploads each asset in series, unlike native compact upload's bounded concurrency. Adopt at most 3–4 concurrent uploads with per-asset retry/progress, preserving final manifest integrity and avoiding too many simultaneous large files.
4. **GridFS repeat loading:** authenticated media uses `private, no-store` for privacy. Benchmark repeat PLY transfer and parse; do not introduce public caching of private captures. Consider small separately generated preview with verified coordinate registration.
5. **Function-lifetime work:** video and native analysis use Next `after()`, which is not a durable queue. Add idempotent job status/recovery before claiming reliable processing under function termination.
6. **Search:** `lib/server/search.ts` checks `listSearchIndexes()` on every search and sequentially embeds up to 50 documents. Benchmark index metadata query and add bounded embedding concurrency/rate-limit handling if needed. Avoid caching index readiness indefinitely.
7. **WebGL disposal:** audit asynchronous `addSplatScene` unmount/race, geometry/material lifecycles and context loss on real devices.
8. **Possible legacy code:** WebRTC signal and browser recording routes are retained while public QR launches native only. These are not proven unused across callers/tests; do not blindly delete before tracing every consumer.
9. **Validation:** `npm ci && npm run lint && npm test && npm run build`; actual iOS RoomPlan upload; owned and forbidden-account access; video YOLO/Gemini and partial failure; marker editing; repeated room changes; search index ready/unready; comparison and reports. None were exercised in this static audit.

Do not treat static presence of a route or a historical test fixture as proof that live endpoints and partner models work on production credentials.
