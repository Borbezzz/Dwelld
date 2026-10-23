# Production diagnosis — 23 October 2026

## Confirmed initial cause

The production deployment `dpl_81ZqZDHWzLAKJEACEQCkpKnPdTkF` served Git commit `9cce2412b9681f93387cb257801261ec764840b2` (the expected MongoDB-only implementation). The Vercel project was `dwelld` in `borbez2s-projects`.

Production environment configuration contained only legacy Blob configuration. `MONGODB_URI`, `MONGODB_DB`, `GEMINI_API_KEY`, and `GEMINI_MODEL` were absent. The same variables were present locally. Actual production requests reproduced HTTP 503 for room list/create and HTTP 400 for upload initialization. Existing catch handlers discarded diagnostics and incorrectly classified upload infrastructure failure as a client error. Runtime log queries returned no records because errors were swallowed.

The four required variables were added to Production from the verified local environment using stdin, without printing values. Credentials use Vercel Secret type. The existing deployment was rebuilt and promoted to load the new environment. Blob is no longer part of the implementation; old Blob configuration was not needed or modified.

## Reliability changes

- Shared API error classification distinguishes missing configuration, MongoDB authentication, network/server selection, malformed database configuration, invalid JSON, AI quota and video processing failures.
- Error responses carry a UUID request ID, stable error code, sanitized explanation and `X-Request-ID` header.
- Server logs contain only allowlisted diagnostic metadata and numeric provider error/status codes. Raw provider messages, request payloads and URLs are not logged.
- Upload infrastructure errors now return server errors, rather than HTTP 400.
- Background inspection errors produce a diagnostic event and persist the request ID in the failed inspection.
- MongoDB connection and server selection have bounded 10-second timeouts; failed cached promises clear so subsequent requests may recover.
- Browser request errors display the request ID.

## Verification status

The initial environment fix exposed an additional production connectivity problem: `/api/rooms` returned HTTP 500 after approximately 30 seconds (MongoDB driver default server selection timeout). An isolated baseline deployment containing sanitized diagnostics and bounded timeouts (`dpl_3c6fssYNfk9qPWJi7T46fL2VqxVD`, https://dwelld-769qxypc5-borbez2s-projects.vercel.app) then returned HTTP 503 `DATABASE_UNREACHABLE` in 10.3 seconds, request ID `4aa1fd28-9a1d-47c2-80fb-34b732e8bb7d`. The same local credential passes a fresh admin ping. This identifies production server selection/network reachability as the remaining blocker, rather than absent configuration or a confirmed authentication rejection. Atlas network access requires inspection; its CLI is installed but not authenticated here. Room creation blocks the remaining production upload/processing/retrieval smoke steps. No production end-to-end success is claimed.
