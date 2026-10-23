# dwelld.

**Your room remembers.** Dwelld helps renters create a timestamped move-in record of a room's visible condition. The MVP focuses on room setup, video-based inspection, AI-generated inventory and damage observations, human review, and saved inspection history.

## Requirements

- Node.js 20 or newer and npm.
- A MongoDB Atlas database and connection string.
- A Google AI Studio API key for Gemini analysis.

The application requires the configured services for its complete inspection workflow. The application does not provide authentication; treat the deployment as a private demo until access control is added.

## Local setup

```sh
npm install
cp .env.example .env.local
```

Fill in the values in `.env.local` (see [Environment variables](#environment-variables)), then start the development server:

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To create a production build locally:

```sh
npm run build
npm run start
```

## Environment variables

Copy `.env.example` to `.env.local`. Keep `.env.local` and all service credentials out of source control. Gemini and MongoDB credentials are used by server-side code only.

| Variable | Required for | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | AI inspection | Google AI API key. Never expose this in a `NEXT_PUBLIC_` variable. |
| `GEMINI_MODEL` | AI inspection | Gemini model identifier used by the server. Set to the model available to your project; the default in the example follows the requested hackathon model. |
| `MONGODB_URI` | Persistence | MongoDB Atlas connection string, including database access credentials. |
| `MONGODB_DB` | Persistence | Database name (default: `dwelld`). |

## MongoDB Atlas setup

1. Create an Atlas cluster and database user. Allow network access from the development machine and, when deployed, from the hosting environment as required by your Atlas network configuration.
2. Copy the Atlas connection string into `MONGODB_URI`; URL-encode special characters in the database user's password.
3. Set `MONGODB_DB=dwelld` (or your chosen database name).
4. Create the Atlas Search index described in [MongoDB Atlas Search indexes](docs/mongodb-atlas-search.md). Atlas Search uses a separately managed Search index; a normal MongoDB index does not replace it.

The app's MongoDB collection names, fields, and Search index definition must match the implementation in this repository. See the index guide before creating or changing an index.

## Deploying to Vercel

1. Import this repository into Vercel and select the Next.js framework preset.
2. Add `GEMINI_API_KEY`, `GEMINI_MODEL`, `MONGODB_URI` and `MONGODB_DB` to the deployment environment.
3. Configure Atlas network access for the deployment.
4. Verify room creation, upload, analysis, review updates and reopening against real services.

Media is stored in MongoDB GridFS. The browser uploads sequential chunks of at most 2 MiB through `/api/uploads`, keeping each request below Vercel's request-body limit. Completed uploads are assembled into GridFS and referenced as `gridfs:<ObjectId>`. Temporary upload records and parts expire; completed original videos and evidence frames are retained. Playback streams from GridFS with byte-range support. No Blob SDK or Blob credentials are required. Existing external Blob assets are not automatically migrated or deleted.

YOLO runs in the browser on three sampled frames. The server extracts matching original-resolution PNGs with FFmpeg and sends object crops and surface views to Gemini. Damage observations reference exact object IDs, not label guesses. The analysis function has a 300-second limit and stops starting model checks near its 240-second working budget. Transient provider failures get one bounded retry. Unfinished checks produce a saved `partial` inspection with explicit warnings; no missing check is interpreted as “undamaged”. Review updates append history in MongoDB. Media routes have no tenant-level authorization; use only controlled, authorised demo footage.

## MVP boundaries

- This is a move-in inspection aid. It does not determine legal liability, estimate repair costs, or compare move-in and move-out condition.
- AI findings are suggestions for tenant review, not verified facts. Review evidence and timestamps before relying on a record.
- The MVP does not include user authentication or tenant/landlord access controls. Do not store sensitive footage in a publicly accessible demo.
- Atlas Vector Search and hybrid search require a compatible Atlas deployment and explicitly configured indexes. They are not implied by ordinary MongoDB queries or Atlas Search alone.

## Verification status (23 October 2026)

MongoDB admin ping and live API persistence checks passed: room creation/read, review transitions with preserved history, reopening findings, and rejecting invalid inspection requests before writing processing records. Temporary test documents were removed. The configured Atlas cluster has a ready, queryable `findings_search` index.

MongoDB-only media verification is recorded in `docs/testing/mongodb-media-verification.md`. Historical Blob checks no longer describe the active storage path.

## Browser object detection

YOLO11n runs locally in the browser using ONNX Runtime Web's CPU/WASM backend. It loads approximately 24 MB of model/runtime assets from this app on first use. No detector API key or GPU server is required; Google Gemini still uses its server-side credential for damage analysis.

The shipped model is pretrained on COCO80. The room filter supports chair, couch, potted plant, bed, dining table, toilet, TV, laptop, microwave, oven, toaster, sink, refrigerator, clock, and vase. It does not recognize an open vocabulary; desk, wardrobe, shelf, door, and window are not supported class names. Unrecognized items remain absent rather than being fabricated. Confidence values are the actual model class scores, not calibrated certainty. Per-frame class-aware non-maximum suppression removes overlapping duplicate detections; it does not establish physical identity across camera views.

Model provenance, export command, checksum and AGPL-3.0 license notice are in [public/models/README.md](public/models/README.md). Browser preprocessing letterboxes original frames to 640×640 and maps detections back into original-frame normalized coordinates. Three synthetic tensor tests verify landscape/portrait geometry, NMS, unsupported classes, score filtering and invalid output shapes; these tests do not establish model accuracy. Real browser WASM inference also passed on two COCO photos: a kitchen returned two ovens; a furnished room returned two chairs, two TVs, a potted plant, a vase, and a clock. The visible dining table was missed, so these checks demonstrate functioning inference rather than complete inventory accuracy. See the model provenance document for source images and measured scores.


## Storage architecture

MongoDB Atlas stores rooms, inspections, object/damage observations, normalized boxes, timestamps, review history and media references. GridFS in the same database stores original video and evidence-image bytes. The user selected MongoDB-only storage on 23 October 2026, superseding the earlier Blob architecture.

Gemini can supplement YOLO with at most four visible wardrobe, bookshelf, desk, chest-of-drawers, sideboard or nightstand observations per sampled frame. These are labelled separately, restricted to valid normalized boxes and suppressed when overlapping existing detections. Real requests have produced both a valid sideboard observation and invalid observations that were discarded. This fallback is not a reliable inventory guarantee. Three sampled frames remain the bounded MVP choice; more frames increase crop calls, latency and cost, and the 300-second function budget may be exceeded for dense scenes. Physical object identity across moving camera views is not resolved.

See [search investigation](docs/search-investigation.md) for actual Atlas capabilities and limits. Consult the current MongoDB media verification report for the tested workflow and remaining deployment limits.
