# Live inspection protocol

MongoDB is the session and media store. Signalling uses short HTTP polling requests; video travels directly by WebRTC. No WebSocket server or managed signalling account is required.

## Capabilities

- `POST /api/live {roomId}` creates a two-hour session and returns separate random `desktopToken` and `pairingToken`. Pairing expires after ten minutes.
- Phone generates and persists random `phoneToken` and `deviceId` **before** `POST /api/live/{id}/pair {pairingToken,phoneToken,deviceId}`. One atomic MongoDB claim prevents a second phone pairing. Phone tokens cannot publish to another session.
- Put QR capability in the URL fragment, never in query strings. Clear the fragment after browser storage. Send capabilities only as `Authorization: Bearer ...`.
- MongoDB stores SHA-256 capability hashes. Poll responses exclude hashes. A pairing capability is not accepted as a phone or desktop capability.
- `GET /api/live/{id}` returns session, cumulative tracked inventory, findings and signals for the receiving role only. Signals replay the latest 200 entries; clients deduplicate by signal ID. This avoids assuming ObjectIds are globally ordered across serverless instances. Persist your capability in session storage for refresh. Sessions expire; completed conventional inspections persist beyond expiration.
- Phone sends WebRTC offers, desktop sends answers. `POST /signal {eventId,type,data}` supports `offer`, `answer`, `ice`, `restart`. Event IDs make retransmissions idempotent.

## Events and media

`POST /events {eventId,type,payload}`: phone publishes `objects.updated` with `{objects}`, `scan.started`, `phone.connected`, `phone.disconnected`; either device requests `scan.stop_requested` or `finding.reviewed` with `{findingId,reviewStatus}`. The phone observes `session.stopRequested`, stops the recorder, uploads and finalizes.

`POST /analyze` is phone-only multipart with `image` (JPEG/PNG/WebP, up to 3MiB), `metadata` JSON `{observationId,timestampSeconds,objects,includeSurfaces}`. At most three objects per AI request. One in-flight analysis per session and fifteen seconds cooldown. Successful retries return the persisted result without a second Gemini request. Manual evidence uses the same route with `{mode:'manual',observationId,timestampSeconds,description,point,parentObjectId?}`; it preserves the image and user marker without Gemini. Manual saves have a separate lease, so they can finish while AI is running and do not inherit the AI cooldown. Finalization waits for both leases. Review changes persist with history.

`POST /upload {filename,contentType,size}` starts a session-scoped upload; `PATCH /upload?uploadId=...&part=N` sends sequential 2MiB binary chunks; `POST /upload {action:'complete',uploadId}` writes the original bytes into GridFS and attaches the reference to this session. Maximum original recording size 100MiB. Retried chunks must have the same digest. The general historical upload endpoint is not used.

`GET /media?ref=gridfs:...` requires the session capability and checks that the evidence/video belongs to this session. Fetch with authorization and create a browser object URL; do not place tokens in media URLs.

`POST /finish {durationSeconds}` requires saved original footage, reserves a stable inspection ID, persists deterministic finding identities and copies reviews/evidence into the existing inspection collections. Repeated calls return the same inspection ID. Reopen using the existing inspection page.

## Networking and limitations

STUN is configured by default. Across restrictive networks, STUN alone cannot guarantee connectivity. Optional `TURN_URLS` (comma-separated turn:/turns: URLs) and `TURN_SHARED_SECRET` enable standard TURN REST HMAC credentials valid for one hour; the shared secret remains server-side. The provider must support this credential scheme. No TURN service has been provisioned or verified.

This is capability pairing, not a general account/login system. Existing unauthenticated historical inspection API behavior is unchanged. Sessions preserve records on expiry; only temporary upload parts and signalling messages have TTL cleanup. Camera tracks and peer connections must be stopped by the client. Upload failures retain the recording in the phone browser only until that page is lost. Large recordings consume phone memory; use short demo scans.

## Verification

Real local MongoDB API probes verify one-device claiming, denied cross-session capabilities, role restrictions, idempotent inventory, recipient-only signalling, scoped media uploads and saved review state. These are backend protocol tests, **not** evidence of physical phone-camera connectivity or cross-network WebRTC success.
