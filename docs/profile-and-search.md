# Profiles and evidence retrieval

Better Auth stores users, password hashes, sessions, accounts and rate-limit records in the existing MongoDB database. Email/password signup requires 12 characters. Authentication uses HttpOnly session cookies; API ownership is checked server-side. Live phone access remains a short-lived scoped bearer capability created by a signed-in room owner.

Set BETTER_AUTH_SECRET (random 32+ characters) and BETTER_AUTH_URL (exact public origin) on each deployment. The local secret is generated in ignored .env.local. Production does not inherit it automatically. Email verification and password-reset email delivery require an email provider and are not currently enabled; sign-up does not assert mailbox ownership.

Existing ownerless demo records are intentionally inaccessible. Do not assign them to the first person signing up. A trusted administrator must audit and explicitly migrate any records that should belong to a real profile.

## Search

`node --env-file=.env --env-file=.env.local scripts/setup-search-indexes.cjs` submits Atlas Search and Vector Search indexes. Wait for both indexes to become queryable. This updates findings_search to include an ownerId token field, and creates findings_vector with a 768-dimension cosine vector plus ownerId/roomId prefilters. All retrieval additionally checks ownership in the pipeline. This command needs Atlas index management permissions.

New inspection completion embeds bounded batches of findings using Gemini embedding-001 RETRIEVAL_DOCUMENT. Search uses RETRIEVAL_QUERY; all vectors are L2-normalised, 768 dimensions. The search panel also provides “Index my findings” to resume indexing in batches of 50 if a model call failed. API: POST /api/search, authenticated and scoped to the user's own records. GET /api/search accepts mode=text|semantic|hybrid. Hybrid combines Atlas text and vector results with reciprocal rank fusion (k=60), rather than incomparable raw score addition. Missing model access or indexes produces an explicit error; no regex or fake semantic fallback.

Sources: https://better-auth.com/docs/adapters/mongo and https://ai.google.dev/gemini-api/docs/embeddings .

Atlas index configurations were submitted successfully during this sprint; queryability and real embedding retrieval must be verified separately.

## Verified locally against Atlas

Real signup, sign-in, owner room create/read, anonymous denial, second-user room/live denial, and cross-origin mutation denial passed. A labelled test finding was embedded by the real Gemini API and retrieved by all three Atlas modes after index propagation; fixture deleted. No claims are made that synthetic fixture text is a detected defect.

## Security verification

Additional real API checks passed: other accounts cannot read reports or spatial assets, create spatial markers, review comparisons, append upload chunks or finalize another account's upload. Oversized JSON is rejected during streaming (413); cross-site Fetch Metadata is rejected even if Origin is missing. Mutation JSON must be an object with application/json content type. Sign-in cookies were verified HttpOnly and SameSite=Lax locally; production HTTPS uses the auth library's secure cookies. Existing same-origin/native cookie requests remain supported.

Search now verifies required Atlas indexes are queryable before running retrieval; an absent/building index returns 503, never a successful empty-result fallback. Atlas propagation is asynchronous and can exceed ten seconds after embedding writes.

Dependency audit: production dependencies report zero advisories. Three development dependency entries refer to the same PostCSS selector-parser CPU exhaustion issue, GHSA-rj75-hqrm-r3gf. The installed Tailwind 3 dependency range has no patched release; fixing it requires a major parser override or Tailwind migration. The advisory explicitly excludes ordinary build-time parsing of trusted sources, which is this app's usage. No forced major upgrade was performed.

## Explicit legacy ownership migration

Use `scripts/assign-legacy-owner.cjs --owner-id <existing-user-id>` with the environment loaded to inspect a dry run. Add `--room-id <legacy-room-id>` to restrict the scope. The CLI refuses missing/nonexistent users, already-owned rooms and conflicting child ownership. It assigns only ownerless room → inspection → finding records and their referenced GridFS metadata in a MongoDB transaction, with an ownership audit record. Orphan files and live capabilities are not claimed.

Only after a trusted administrator has checked that the records belong to the chosen account should they rerun the same command with `--apply`. No automatic migration occurs on signup. During this sprint a dry run found six legacy rooms, four inspections, eight findings and five referenced media files; **apply was not run**.

Report evidence stays behind authenticated same-origin media endpoints. Browser print/PDF export waits for all confirmed evidence images to load and reports failures instead of silently exporting missing images. Screen-space annotation coordinates are applied to the original image's aspect ratio, and marker print colours are explicitly preserved. JSON exports retain timestamps/coordinates; their media references require an authenticated session and are not public share links.
