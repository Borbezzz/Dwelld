# dwelld.

**Your room remembers.** Dwelld helps renters create a timestamped move-in record of a room's visible condition. The MVP focuses on room setup, video-based inspection, AI-generated inventory and damage observations, human review, and saved inspection history.

## Requirements

- Node.js 20 or newer and npm.
- A MongoDB Atlas database and connection string.
- A Google AI Studio API key for Gemini analysis.
- A Vercel Blob read/write token for storing uploaded videos and evidence frames.

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
| `BLOB_READ_WRITE_TOKEN` | Media storage | Vercel Blob token with read/write access for the configured store. |

## MongoDB Atlas setup

1. Create an Atlas cluster and database user. Allow network access from the development machine and, when deployed, from the hosting environment as required by your Atlas network configuration.
2. Copy the Atlas connection string into `MONGODB_URI`; URL-encode special characters in the database user's password.
3. Set `MONGODB_DB=dwelld` (or your chosen database name).
4. Create the Atlas Search index described in [MongoDB Atlas Search indexes](docs/mongodb-atlas-search.md). Atlas Search uses a separately managed Search index; a normal MongoDB index does not replace it.

The app's MongoDB collection names, fields, and Search index definition must match the implementation in this repository. See the index guide before creating or changing an index.

## Deploying to Vercel

1. Import this repository into Vercel and select the Next.js framework preset.
2. Add `GEMINI_API_KEY`, `GEMINI_MODEL`, `MONGODB_URI`, `MONGODB_DB`, and `BLOB_READ_WRITE_TOKEN` in the Vercel project's environment settings for each deployment environment.
3. Configure Atlas network access for the deployment and ensure the Blob token points to the intended store.
4. Deploy and verify room creation, a real video inspection, review updates, and reopening an inspection against the configured services.

Video uploads use Vercel Blob's private upload flow, rather than sending the full video through a standard serverless request body. Private Blob delivery depends on the application serving authorized access to the file; do not expose or log private URLs. The MVP has no user authentication, so do not use it to store sensitive footage until access controls are added.

The AI pipeline sends the stored source video to Gemini, extracts JPEG evidence frames at the returned timestamps, and stores the frames privately alongside structured findings. Evidence annotations are localized against those extracted still frames. The bundled FFmpeg binary is included in Vercel function file tracing; the inspection function requests a 300-second execution limit, which must be supported by the hosting plan. Long model processing or media jobs may exceed that limit and should use a durable job worker before production use. Review changes append an atomic history entry so earlier review decisions remain available in MongoDB. Damage links to an object only when the model's object label identifies one object unambiguously. Review the results as suggestions, and verify service limits and model availability for your project before a live demo.

## MVP boundaries

- This is a move-in inspection aid. It does not determine legal liability, estimate repair costs, or compare move-in and move-out condition.
- AI findings are suggestions for tenant review, not verified facts. Review evidence and timestamps before relying on a record.
- The MVP does not include user authentication or tenant/landlord access controls. Do not store sensitive footage in a publicly accessible demo.
- Atlas Vector Search and hybrid search require a compatible Atlas deployment and explicitly configured indexes. They are not implied by ordinary MongoDB queries or Atlas Search alone.

## Verification status (23 October 2026)

MongoDB admin ping and live API persistence checks passed: room creation/read, review transitions with preserved history, reopening findings, and rejecting invalid inspection requests before writing processing records. Temporary test documents were removed. The configured Atlas cluster has a ready, queryable `findings_search` index.

The complete upload-to-analysis flow still requires `BLOB_READ_WRITE_TOKEN` in the local environment. Without it, the inspection endpoint returns HTTP 503 before creating a processing record. A successful MongoDB or Gemini connectivity check alone does not verify video analysis, evidence extraction, or private media delivery.

## Browser object detection

YOLO11n runs locally in the browser using ONNX Runtime Web's CPU/WASM backend. It loads approximately 24 MB of model/runtime assets from this app on first use. No detector API key or GPU server is required; Google Gemini still uses its server-side credential for damage analysis.

The shipped model is pretrained on COCO80. The room filter supports chair, couch, potted plant, bed, dining table, toilet, TV, laptop, microwave, oven, toaster, sink, refrigerator, clock, and vase. It does not recognize an open vocabulary; desk, wardrobe, shelf, door, and window are not supported class names. Unrecognized items remain absent rather than being fabricated. Confidence values are the actual model class scores, not calibrated certainty. Per-frame class-aware non-maximum suppression removes overlapping duplicate detections; it does not establish physical identity across camera views.

Model provenance, export command, checksum and AGPL-3.0 license notice are in [public/models/README.md](public/models/README.md). Browser preprocessing letterboxes original frames to 640×640 and maps detections back into original-frame normalized coordinates. Three synthetic tensor tests verify landscape/portrait geometry, NMS, unsupported classes, score filtering and invalid output shapes; these tests do not establish model accuracy. Real browser WASM inference also passed on two COCO photos: a kitchen returned two ovens; a furnished room returned two chairs, two TVs, a potted plant, a vase, and a clock. The visible dining table was missed, so these checks demonstrate functioning inference rather than complete inventory accuracy. See the model provenance document for source images and measured scores.
