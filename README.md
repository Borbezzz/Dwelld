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

The current AI pipeline sends the stored source video to Gemini and stores structured findings. Review the results as suggestions, and verify service limits and model availability for your project before a live demo.

## MVP boundaries

- This is a move-in inspection aid. It does not determine legal liability, estimate repair costs, or compare move-in and move-out condition.
- AI findings are suggestions for tenant review, not verified facts. Review evidence and timestamps before relying on a record.
- The MVP does not include user authentication or tenant/landlord access controls. Do not store sensitive footage in a publicly accessible demo.
- Atlas Vector Search and hybrid search require a compatible Atlas deployment and explicitly configured indexes. They are not implied by ordinary MongoDB queries or Atlas Search alone.
