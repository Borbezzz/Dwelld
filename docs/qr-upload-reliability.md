# Website-first iPhone capture

The normal native screen has no sign-in, server-address, room-selection or
inspection-type controls. Start the inspection on the laptop, scan its QR with
the iPhone camera and tap Open Dwelld Capture. iOS requires this handoff gesture.
The existing server phone capability selects the account, room and inspection.

- Claim credentials are saved in the device-only Keychain before the pair request.
  A repeated QR link reuses the phone token and device ID, allowing the server's
  existing idempotent pairing path to recover a lost response.
- A successful connection survives app relaunch. A finished capture's folder and
  manifest are restored, including uploaded GridFS references.
- Finish & save processes the capture and starts upload automatically. Retry save
  resumes completed assets. The screen stays awake during upload and shows progress.
- A different inspection cannot claim an unfinished capture accidentally.
- Saved status disables duplicate capture submission. Start another inspection on
  the website for the next scan.

Limits: this is a foreground URLSession upload. Keep the app open while saving;
force-quitting may restart an unfinished asset. Existing server capabilities still
expire after two hours. This change does not extend authorization lifetimes. An
expired connection cannot upload without renewed authorization; local files remain
exportable. A phone previously installed with the old app cannot recover an old
in-memory capability that was already lost.

## Vercel deployment investigation

Latest inspected production deployment: dwelld-221mu31j7-borbez2s-projects.vercel.app.
Logs report build completion in 53 seconds, output deployment approximately 60
seconds, and a 548 MB build cache. Dependency installation already uses cache.

`vercel.json` now runs `scripts/vercel/ignore-build.cjs`. It compares against
`VERCEL_GIT_PREVIOUS_SHA` and skips only iOS/docs/README-only changes. Missing history
or any other changed file triggers a normal build. This avoids redeploying the
website for native-app-only commits. Vercel-only tracing exclusions remove ONNX's
Windows and macOS binaries from Linux function bundles; Linux binaries and models
are retained. No measured latency improvement is claimed yet.

The QR fixes were developed on an isolated branch and combined with the native
live-splat renderer. The combined simulator build passes. An updated native app
installation and a physical QR-to-save run are still required; a web deployment
cannot update an already-installed iPhone app.

## Lost save acknowledgement recovery (24 October 2026)

A native session could be `saved` with its last progress still showing 96% uploading.
The server now writes terminal upload progress on manifest acceptance and normalizes older
saved sessions to 100% in its public projection. The laptop gives saved status precedence
over stale progress.

The native saver cancels the optional live-evidence task before uploading remaining files,
limits parallel assets to four, and uses 30-second request / 120-second resource timeouts.
It checks remote saved status before starting, while saving, and after an upload error.
A confirmed server save cancels remaining requests and persists completion locally so a lost
final HTTP response does not leave the phone waiting. Late asset responses cannot overwrite
that terminal state. Connection failures retain the local manifest and completed asset refs.

Validation: signed physical-device build and TypeScript checks pass; saved-state regression
coverage is included in the Node suite. Installation does not itself verify a fresh physical
scan, network interruption, or RoomPlan processing callback.
