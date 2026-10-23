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

The QR fixes were developed on an isolated branch because the main checkout was
actively editing the same native files for the live splat preview. Integrate those
changes together before installing a combined build.
