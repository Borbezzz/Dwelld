# Production recovery — 23 October 2026

## Incident traced

The user-reported request `dae837e0-592a-4b5c-af2f-94c300f397ac` is present in Vercel runtime logs for `/api/rooms` on deployment `dpl_F7TZHwFt5L5wceNby8zTiHLRa1yT`, main commit `7b9371ae960b06722ac77d0cfc9bfa416b5e467f`. It failed in region `lhr1` with `MongoServerSelectionError`. The original classifier intentionally discarded all driver messages, including the nested cause.

A separate staged production build of that exact baseline plus safe diagnostic categorization (not concurrent UI changes) reproduced the error in `lhr1` and `sfo1`. The nested driver cause was categorized `tls_handshake` and `tls_remote_internal_alert` (fixed matcher for `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR` / TLS remote internal alert). This shows failure before database authentication; the generic server-selection label alone was insufficient to diagnose it.

## Checks performed

- Correct Vercel team/project: `borbez2s-projects/dwelld`.
- Production environment has MongoDB URI and database name. Both were added before the deployed main build. Environment changes require a new deployment; this build postdates those changes.
- Nonsecret Production database name equals local `dwelld` exactly.
- Current local URI passes `client.db("admin").command({ ping: 1 })`.
- Local client inserted, read and deleted a dedicated temporary diagnostic document in `dwelld`.
- Local URI has no leading/trailing whitespace or newlines. Successful authentication proves its credential encoding and authSource work.
- The cluster is running and reachable locally, so it is not globally paused.
- Atlas CLI is not authenticated. The coordinator subsequently inspected the authenticated Atlas dashboard: Cluster0 is active on FREE, the SCRAM user has atlasAdmin, and the project IP Access List contains **only the local client IP /32**. Vercel egress is absent. This establishes the network-policy mismatch responsible for the local/production difference.
- A temporary protected staging-only comparison probe confirmed the Production URI **exactly equals** the locally working URI. It returned booleans only; no URI, credentials or digest was returned/logged. Parsed cluster and authSource also match. The probe is absent from the repository and its deployment was deleted after verification.
- URI scheme is standard `mongodb://`, not SRV, so SRV lookup is not involved. It parses correctly, has no outer quotes/whitespace, and enables TLS. A remote TLS alert means the client reaches the TLS peer; this is not a DNS-resolution failure.
- Repeated the local admin ping and write/read/delete with Node 24, matching production's major version: all passed.
- No TLS validation, connection string, authSource or credentials have been changed.

## Diagnostics safety

`databaseDiagnostics` traverses bounded driver causes and topology server errors, reporting fixed categories only. It never logs raw messages, stack traces, hostnames, URI values, arbitrary string error codes, credentials or database documents. Tests cover topology nesting, TLS, DNS, authentication, authorization, timeouts and cyclic causes.

## Production recovery verified

The user explicitly approved a six-hour temporary `0.0.0.0/0` Atlas access rule, and the coordinator submitted it. At 20:22–20:23 BST on 23 October, the existing main production deployment succeeded without changing the connection string or redeploying. This controlled change confirms the missing Vercel network access as the cause.

Actual requests to `https://dwelld.vercel.app` passed:

1. Create room (201) and retrieve it in the room list.
2. Create live session (201), claim pairing token and read the paired state using desktop credentials.
3. Upload 11,784,677 bytes in six chunks to session-scoped GridFS storage.
4. Retrieve the complete media and compare every byte to the original fixture.
5. Retrieve a byte range (206) and compare it to the original byte range.
6. Finish the session, reopen the saved inspection and retrieve its original video byte-for-byte.

Evidence room: `6adbb411fd18996e0aea9ddb`, titled **Production storage recovery verification**. Session: `6adbb413fd18996e0aea9ddc`. Saved inspection: `6adbb434fd18996e0aea9ddd`.

This used a three-second static room-photo MP4 as a **storage fixture**. No detections were submitted (0 findings). Pairing here verifies API token/state persistence only, not physical iPhone camera capture, WebRTC, YOLO, or Gemini. Those remain separate acceptance gates. A production admin ping endpoint was not introduced; real production collection and GridFS reads/writes are stronger application-path evidence.

The temporary Atlas rule expires after six hours. Durable production connectivity still needs an approved long-term policy. Repeat these API/storage checks against the integrated correction release; this verification was against the previously deployed main build.

References: [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/) and [Atlas network requirements](https://www.mongodb.com/docs/atlas/setup-cluster-security/).

## Network options inspected (coordinator applied approved temporary rule)

Read-only Vercel API checks confirm the team is on Hobby; `GET /v1/connect/networks` returns an empty list, and the project has no static egress/secure compute configuration. There are no existing stable egress addresses to add to Atlas.

- Durable narrow allowlist: enable Vercel Static IPs, then add the assigned regional address pairs in Atlas. This is a Pro-or-higher paid feature, currently $100/project/month plus transfer, and needs an explicit plan/spend decision. No upgrade or purchase was made.
- Temporary verification on the current Hobby deployment: with explicit user approval, add an expiring Atlas `0.0.0.0/0` access entry (for example, six hours), retaining TLS and SCRAM authentication. This broadens network access and is not equivalent to a narrow production allowlist. Remove/expire it after verification or replace it with stable egress access.
- Do not treat a single observed Vercel function IP as durable: default outbound addresses change.

Production also has no TURN configuration environment variables. Cross-network phone WebRTC relay testing remains separate from MongoDB connectivity recovery.

Sources: [Vercel static egress options](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address), [Static IP availability](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address), [current pricing](https://vercel.com/pricing).
