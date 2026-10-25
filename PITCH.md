# Dwelld: pitch and how it meets each track

> **Dwelld turns a two-minute phone scan into evidence that holds up in a deposit dispute.**

Entered in: **Google DeepMind (Gemini 4 Argon)** · **MongoDB Atlas** · **The Real World**.
Bounty rules: [`docs/BOUNTY-REQUIREMENTS.md`](docs/BOUNTY-REQUIREMENTS.md). Live app: [dwelld.dev](https://www.dwelld.dev/).

---

## 1. Who it's for

Students and renters moving into furnished rooms. Almost a quarter of private renters (22%) report unfair deductions from their deposit, but only 4% use the formal dispute process ([Generation Rent, July 2025](https://www.generationrent.org/2025/07/21/flaws-in-deposit-protection-cost-1-in-5-private-renters-hundreds-of-pounds-press-release/)). Most people don't challenge a charge because they have no proof.

Move-in inventories today are paper checklists and a handful of phone photos with no location, no timestamp anyone trusts, and no way to show that *this* scratch is *that* scratch. Some apps do a 3D scan, but it only shows what the room looks like, not where the damage is.

## 2. Storyline

1. **The problem:** one in five renters say their deposit was cut unfairly, and only 4% challenge it, because they have no proof.
2. **The promise:** "Scan your room on day one. Dwelld builds it in 3D, finds and pins every mark, and remembers it."
3. **Capture:** the iPhone LiDAR scan builds the room live on the laptop.
4. **Understand:** Gemini 4 Argon flags candidates. A second Argon pass argues against each one. A geometric check rejects fake "cracks" (board edges, door gaps). Anything the AI missed, you tap, and Argon describes it in context.
5. **Remember:** every finding is in MongoDB Atlas, pinned to a 3D position with its source photo, and searchable by keywords, by meaning and by **what the photo looks like**.
6. **Prove:** at move-out, scan again (or continue the earlier scan; it relocalizes into the same coordinates). Argon compares both inspections side by side: same cabinet, same chip, already there at move-in.
7. **Close:** "Dwelld doesn't pretend to find everything. It makes every claim checkable: who saw it, where, when, and how sure we are."

We don't claim fully automatic damage detection. What we built instead lines up with the judging: Gemini scores "a real verification loop" and "keeps people in control". The Real World scores "honesty about uncertainty". MongoDB scores the search we built on top of the evidence.

## 3. How Dwelld meets each track

### Google DeepMind: Gemini 4 Argon

| Criterion (weight) | What we show | Where in code |
| --- | --- | --- |
| **Working live demo (50%)**: real inputs, under 3 min, Argon used effectively, **real verification loop** | A live LiDAR scan of a real room on stage. Argon checks each evidence photo as it arrives. **Two verification loops with concrete pass/fail signals:** (1) a second, adversarial Argon pass (`thinking_level: medium`) tries to reject every finding; ≥0.85 confidence auto-approves, "not damage" ≥0.6 drops it. (2) A deterministic edge + LiDAR-depth test accepts or rejects every crack: a depth step of 1.2 cm or more, or a brightness step across the line, means it's an object edge. | `lib/server/frame-analysis.ts`, `lib/server/verify.ts`, `lib/server/crack-check.ts` |
| **Problem and usefulness (25%)**: a real user, could become a product | Students and renters disputing deposit deductions. Product path: renters and students first, then letting agents and universities who run thousands of check-ins and check-outs. | — |
| **Needs Argon (15%)** | See "Why Gemini 4 Argon" below. **People stay in control:** nothing is final until a person confirms it. Rejections are visible, not hidden. No action leaves the app without the user. | `components/room-detail.tsx` (review), `app/api/inspections/[id]/findings` |
| **Clarity (10%)**: user and product clear in 3 min, no slides | The live demo uses the product only, with no slides. | — |

**Why Gemini 4 Argon, and why this wouldn't work on a smaller model**

- **Spatial, multimodal reasoning over real sensor data.** Each check gets the original-resolution photo plus a scoped brief for the RoomPlan object in view (table, cabinet, door, wall). Argon has to tell a scuff from a reflection, a sticker from residue, a door gap from a crack, and return pixel boxes we can project into 3D.
- **Long context for the move-out comparison.** Argon (`thinking_level: high`) reads both inspections together: up to 16 evidence photos per side at 1280 px, plus up to 100 findings per side with labels, descriptions and timestamps. The work is split into up to four parallel batches, but every batch sees both scans in full and reports only on its own targets, so cross-references survive. It returns furniture correspondences and real changes, which is how it can say "same chip, already there".
- **Frontier reasoning as its own critic.** The verification pass is Argon arguing *against* Argon's own first answer, with the photo and the box. Weaker models just agree with themselves.
- **Describe-at-point.** When a person taps a spot the AI missed, Argon gets the photo and the exact 3D-projected point and writes what's there in context ("chipped laminate on the front-left corner of the desk, about 2 cm"). The human decides *where*; Argon writes the evidence.
- **Honest scale note for Q&A:** we use the long context for comparison and batched frame inspection, not the full 1M tokens. Raising the photo cap is a config change, `COMPARE_IMAGES_PER_SIDE` in `lib/server/comparison.ts`.

**Gemini models and agents used:**

| Model | Used for |
| --- | --- |
| `gemini-4-argon` | Live damage detection per evidence photo (scoped prompts per furniture type, structured JSON with boxes). Batched multi-photo inspection after a scan. Adversarial verification of every finding (`thinking_level: medium`). Describing manually marked damage at a 3D point. Move-in vs move-out comparison (`thinking_level: high`). Ask Records answers with cited sources. |
| `gemini-embedding-001` | 768-d text vectors for findings, the fallback meaning search when Atlas Automated Embedding isn't ready. |
| SDK | `@google/genai` 2.31 with `thinkingLevel`. No temperature, top-p or top-k. |
| Coding agents | Built during the hackathon with AI coding agents. |

### MongoDB Atlas

Atlas is the only database. It holds rooms, inspections, findings, 3D scan manifests, live scan sessions, Better Auth users and sessions, and **every media file in GridFS**: photos, depth maps, LiDAR splats, USDZ and ARKit world maps.

| Atlas feature | Used? | How |
| --- | --- | --- |
| **Atlas Search** | ✅ | `findings_search`: `$search`, fuzzy full-text over label, description and damage type, with owner and room filters. |
| **Atlas Vector Search** | ✅ | `findings_image` (1024-d photo vectors) and `findings_vector` (768-d Gemini vectors), with owner and room pre-filters. |
| **Automated Embedding** | ✅ | `findings_auto`: an `autoEmbed` index on `searchText` with `voyage-4`. Atlas embeds every finding on write and the query text at query time (`$vectorSearch` with `query: {text}`). There's no embedding code in the app for this path. |
| **Hybrid Search** | ✅ | One native `$rankFusion` stage fuses keyword, meaning and photo pipelines (weights 1, 1, 0.8) with `scoreDetails`, so the UI shows each pipeline's rank for every result. |
| **Voyage AI by MongoDB** | ✅ | `voyage-4` (through Automated Embedding). `voyage-multimodal-3.5` embeds each evidence photo, cropped to the damage, into the same space as text, so "something sticky on the desk" finds the sticker-residue photo. `rerank-3` reorders the fused results. All through `ai.mongodb.com/v1`. |
| Atlas Stream Processing | ❌ | Not used. |
| GridFS | ✅ (bonus) | All binary evidence, served privately with byte ranges. |

**What the search lab at `/search` shows:**
1. The **index panel**: all four indexes READY, MongoDB version, "$rankFusion supported", counts of auto-embedded, Gemini and photo vectors.
2. Type a query with **no keyword overlap**, for example *"something sticky left behind"*. Keywords find nothing or little. Meaning and photos find the sticker residue. The fused list shows the colour bars and ranks from each pipeline.
3. Open **"The query Atlas ran"**: the real `$rankFusion` pipeline JSON, with the vector shortened.
4. The **vector space map**: every finding as a dot placed by its photo embedding, your search dropped in as a star, and lines to the five nearest photos. Hover a dot to see its photo.

Setup on the deployed app: set `VOYAGE_API_KEY` in Vercel, open `/search`, click **Create or update indexes**, wait for READY, then click **Prepare my findings**.

### The Real World

| Criterion | What we show |
| --- | --- |
| **Real-world usefulness** | Deposit disputes at the end of every tenancy. Renters, students and the people who check them in and out. |
| **How well it reads the world**, incl. messy inputs | Real LiDAR + RGB from an iPhone. Motion-aware frame picking (the steadier of each pair of frames). Depth-confidence filtering (LiDAR confidence 2 only, 0.2–6 m). Coverage warnings ("photos and LiDAR geometry do not cover every surface"). The crack check rejects board edges and door gaps using depth. Duplicate findings are merged by 3D position. A scan can be **resumed later** by relocalizing with ARKit into the same coordinates. |
| **Technical execution** | End to end: phone scan → live 3D on the laptop → Gemini + YOLO + geometry checks → Atlas → search → move-out comparison → report. |
| **Responsibility: privacy** | Full-resolution originals **stay on the phone**. Only sampled evidence photos and a compact point cloud are uploaded. Dwelld is meant for **empty rooms** at move-in and move-out. Every record and media file is owner-scoped and served `private, no-store`. Room scans aren't public. We don't detect or blur faces; the empty-room rule is the safeguard, and we say so. |
| **Responsibility: honesty about uncertainty** | Every AI finding starts **amber (needs a look)** until a person confirms it, unless the verifier is at least 85% sure (the threshold is configurable). The verifier's verdict and confidence are stored and shown. Rejected crack candidates are reported, not silently dropped. Search shows which index answered and when a fallback was used. The comparison states that "unseen areas cannot establish absence". A missing detection is never presented as "no damage". |

**Models and data sources:** Gemini 4 Argon (detection, verification, describe-at-point, comparison, Q&A). gemini-embedding-001. Voyage voyage-4 (via Atlas Automated Embedding), voyage-multimodal-3.5 and rerank-3. YOLO11n (Ultralytics, AGPL-3.0, ONNX in the browser) for object detection on uploaded walkthrough videos. A YOLOv8n-seg crack model (`public/models/CRACK-MODEL.md`) as a crack candidate source, screened by our edge + depth check. Apple RoomPlan (furniture and wall geometry) and ARKit (LiDAR depth, camera poses, world-map relocalization). **Data:** only the user's own phone captures (RGB, LiDAR depth, camera poses). No third-party or open datasets.

### Proving when: the evidence seal

The obvious question is "how do I know this was taken at move-in?" Dwelld seals every saved scan. The server fingerprints each evidence file with SHA-256 and chains the seal to the previous one, so any edit or backdating breaks the chain. Each seal is signed with an Ed25519 key that anyone can check. The report shows "Verified" after re-hashing every file live. Anyone can click **Verify again** on a report. Its limit: it proves nothing changed after sealing, and sharing the room with the landlord at move-in is what shows when the evidence existed.

## 4. Technology used

- **Phone:** SwiftUI app (`ios/DwelldCapture`, iOS 17), RoomPlan, ARKit (LiDAR `sceneDepth`, `ARWorldMap` save and relocalize), Metal live splat renderer, Keychain QR pairing.
- **Web:** Next.js 15, React 19, TypeScript, Three.js, `@mkkellogg/gaussian-splats-3d` (LiDAR-initialized Gaussian splats), WebRTC with TURN, deployed on Vercel.
- **AI:** Gemini 4 Argon and gemini-embedding-001 via `@google/genai`; Voyage AI (voyage-4, voyage-multimodal-3.5, rerank-3) via the Atlas Embedding API; YOLO11n and the crack model via onnxruntime; our own crack edge + depth check (`sharp`, Sobel, Hough transform, plane-plus-step depth fit).
- **Data:** MongoDB Atlas (M0) with GridFS, Atlas Search, Vector Search, Automated Embedding, `$rankFusion` hybrid search. Better Auth with the MongoDB adapter.
- **Media:** sharp, ffmpeg-static.

## 5. Common questions

- *Why not just photos?* Photos have no location and no proof they show the same spot. We pin each one in 3D and match it across scans.
- *What if the AI is wrong?* It's a suggestion until a person confirms it. The verifier and the depth check reject a lot, and we show what they rejected.
- *Privacy?* Originals stay on the phone. It's for empty rooms. Everything is owner-scoped.
- *Built before kickoff?* The repo was created Friday 17:11, after hacking started. The first large commit was written with AI coding agents.
