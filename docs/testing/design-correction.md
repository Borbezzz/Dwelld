# Production and design correction — 23 October 2026

## Visual corrections

- Replaced the landing hero's fixed 244px cropped illustration container with a full-width image at its native 1400×933 ratio. Removed the inherited polygon pseudo-element that obscured the photograph.
- Flat room/history lists, inline room creation and expandable search replace decorative room cards, badges and illustrations. Serif editorial hierarchy, paper neutrals and consistent spacing organize the page.
- Live workspace uses approximately 74% video / 26% inventory, one vertical separator and no outer card. Live video preserves source aspect ratio; portrait feeds are bounded to 70svh without cropping. Normalized boxes are positioned on the exact video plane. Blue object borders, small red damage indicators, labels only on selection/hover/focus.
- New inventory rows animate once on entry. Pending work, saving and playback states come from real application events. Reduced-motion disables transitions.

## Checks

29 tests pass, TypeScript and production build pass. Browser desktop1440px and mobile390px layouts inspected; no horizontal overflow. Mobile photograph preserves complete scene. Desktop prepared video plane measured965×543px with345px inventory. Before/after captures kept in the task visualization directory. Room creation disclosure, navigation and search controls preserved.

Local real Mongo protocol test passed secure pairing, scoped signaling, upload/byte-exact read, manual evidence, review, finish/reopen. Its protocol observations are fixtures, not evidence of camera inference. Production Mongo network recovery and byte-exact11.2MiB storage verification are documented in production-recovery.md.

## Pairing corrections

Serialized SDP-before-ICE writes, negotiation IDs, bounded early-ICE queues and database-allocated signal sequences prevent stale replay and out-of-order candidates across serverless instances. Desktop connected status now requires a remote video playing event. Safe diagnostics disclose connection states only. Recording start has a reentry guard; unexpected MediaRecorder stop preserves available chunks.

## Remaining acceptance

Actual iPhone camera permission, real remote video playback, camera YOLO throughput, live Gemini calls and physical-phone save/reopen must be exercised on the deployed build. No simulated footage is used or accepted as verification. TURN support exists but credentials are not configured, so restricted-network video may fail. The approved Atlas any-IPv4 rule expires 24 October2026 at02:21:58 Europe/London; it is a temporary verification remedy, not a permanent restricted-egress deployment.
