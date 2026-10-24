# Dwelld: pitch, storyline and demo plan

> **Dwelld turns a two-minute phone scan into evidence that holds up in a deposit dispute.**

Entered in: **Google DeepMind (Gemini 4 Argon)** · **MongoDB Atlas** · **The Real World**.
Exact bounty rules: [`docs/BOUNTY-REQUIREMENTS.md`](docs/BOUNTY-REQUIREMENTS.md). Deadline: **Sunday 12:00**.

---

## 1. The person (fill in before recording)

**[Friend's name]** rented a room in a university dorm. When he moved out, the university said he had damaged **[the desk / wardrobe door / wall, fill in]** and charged him **£[amount]**. The damage was already there when he moved in. He had no proof, so he paid.

Use his real first name in the video and the live demo. The Gemini judges score "a specific person you can name" at 25%. If he agrees, show one photo of the actual item, or quote one line from the charge email.

Why it's a real problem outside the hackathon: every renter and student moving into a furnished room faces the same thing. Move-in inventories are paper checklists and a handful of phone photos with no location, no timestamp anyone trusts, and no way to show that *this* scratch is *that* scratch.

## 2. Storyline (the thread through video, live demo and Q&A)

1. **The problem (10 s):** "[Name] paid £[amount] for a scratch that was there before he moved in."
2. **The promise:** "Scan your room on day one. Dwelld builds it in 3D, finds and pins every mark, and remembers it."
3. **Capture:** the iPhone LiDAR scan builds the room live on the laptop.
4. **Understand:** Gemini 4 Argon flags candidates. A second Argon pass argues against each one. A geometric check rejects fake "cracks" (board edges, door gaps). Anything the AI missed, you tap, and Argon describes it in context.
5. **Remember:** every finding is in MongoDB Atlas, pinned to a 3D position with its source photo, and searchable by keywords, by meaning and by **what the photo looks like**.
6. **Prove:** at move-out, scan again (or continue the earlier scan; it relocalizes into the same coordinates). Argon compares both inspections side by side: same cabinet, same chip, already there at move-in.
7. **Close:** "Dwelld doesn't pretend to find everything. It makes every claim checkable: who saw it, where, when, and how sure we are."

The positioning matters: we are **not** claiming fully automatic damage detection. The rules reward exactly what we built instead. Gemini scores "a real verification loop" and "keeps people in control". The Real World scores "honesty about uncertainty". MongoDB scores the search we built on top of the evidence.

## 3. How we hit every criterion

### Google DeepMind: Gemini 4 Argon

| Criterion (weight) | What we show | Where in code |
| --- | --- | --- |
| **Working live demo (50%)**: real inputs, under 3 min, Argon used effectively, **real verification loop** | A live LiDAR scan of a real room on stage. Argon checks each evidence photo as it arrives. **Two verification loops with concrete pass/fail signals:** (1) a second, adversarial Argon pass (`thinking_level: medium`) tries to reject every finding; ≥0.85 confidence auto-approves, "not damage" ≥0.6 drops it. (2) A deterministic edge + LiDAR-depth test accepts or rejects every crack: a depth step of 1.2 cm or more, or a brightness step across the line, means it's an object edge. | `lib/server/frame-analysis.ts`, `lib/server/verify.ts`, `lib/server/crack-check.ts` |
| **Problem and usefulness (25%)**: named person, could become a product | [Friend's name]'s dorm charge. Product path: renters and students first, then letting agents and universities who run thousands of check-ins and check-outs. | — |
| **Needs Argon (15%)** | See "Why Gemini 4 Argon" below. **People stay in control:** nothing is final until a person confirms it. Rejections are visible, not hidden. No action leaves the app without the user. | `components/room-detail.tsx` (review), `app/api/inspections/[id]/findings` |
| **Clarity (10%)**: user and product clear in 3 min, no slides | The live demo uses the product only, with no slides. (The deck in §7 is for the recorded video's opening and closing only.) | — |

**Why Gemini 4 Argon, and why this wouldn't work on a smaller model**

- **Spatial, multimodal reasoning over real sensor data.** Each check gets the original-resolution photo plus a scoped brief for the RoomPlan object in view (table, cabinet, door, wall). Argon has to tell a scuff from a reflection, a sticker from residue, a door gap from a crack, and return pixel boxes we can project into 3D.
- **Long context for the move-out comparison.** One Argon call (`thinking_level: high`) reads both inspections at once: up to 16 evidence photos per side at 1280 px, plus up to 100 findings per side with labels, descriptions and timestamps. It returns furniture correspondences and real changes. That's the only way to say "same chip, already there". Splitting it into per-photo calls loses the cross-references.
- **Frontier reasoning as its own critic.** The verification pass is Argon arguing *against* Argon's own first answer, with the photo and the box. Weaker models just agree with themselves.
- **Describe-at-point.** When a person taps a spot the AI missed, Argon gets the photo and the exact 3D-projected point and writes what's there in context ("chipped laminate on the front-left corner of the desk, about 2 cm"). The human decides *where*; Argon writes the evidence.
- **Honest scale note for Q&A:** we use the long context for comparison and batched frame inspection, not the full 1M tokens. Raising the photo cap is a config change, `COMPARE_IMAGES_PER_SIDE` in `lib/server/comparison.ts`.

**Gemini models and agents used (paste into the submission):**

| Model | Used for |
| --- | --- |
| `gemini-4-argon` | Live damage detection per evidence photo (scoped prompts per furniture type, structured JSON with boxes). Batched multi-photo inspection after a scan. Adversarial verification of every finding (`thinking_level: medium`). Describing manually marked damage at a 3D point. Move-in vs move-out comparison (`thinking_level: high`). Ask Records answers with cited sources. |
| `gemini-embedding-001` | 768-d text vectors for findings, the fallback meaning search when Atlas Automated Embedding isn't ready. |
| SDK | `@google/genai` 2.31 with `thinkingLevel`. No temperature, top-p or top-k. |
| Coding agents | Built during the hackathon with AI coding agents (Codex and Claude). **Adjust this line to match what the team actually used.** |

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

**What to show (the search lab at `/search`):**
1. The **index panel**: all four indexes READY, MongoDB version, "$rankFusion supported", counts of auto-embedded, Gemini and photo vectors.
2. Type a query with **no keyword overlap**, for example *"something sticky left behind"*. Keywords find nothing or little. Meaning and photos find the sticker residue. The fused list shows the colour bars and ranks from each pipeline.
3. Open **"The query Atlas ran"**: the real `$rankFusion` pipeline JSON, with the vector shortened.
4. The **vector space map**: every finding as a dot placed by its photo embedding, your search dropped in as a star, and lines to the five nearest photos. Hover a dot to see its photo.
5. Cut to the **Atlas UI** for 3 seconds: the `findings` collection, one document, and the Search Indexes tab.

Setup on the deployed app: set `VOYAGE_API_KEY` in Vercel, open `/search`, click **Create or update indexes**, wait for READY, then click **Prepare my findings**.

### The Real World

| Criterion | What we show |
| --- | --- |
| **Real-world usefulness** | [Friend's name]'s deposit. Renters, students and the people who check them in and out. |
| **How well it reads the world**, incl. messy inputs | Real LiDAR + RGB from an iPhone. Motion-aware frame picking (the steadier of each pair of frames). Depth-confidence filtering (LiDAR confidence 2 only, 0.2–6 m). Coverage warnings ("photos and LiDAR geometry do not cover every surface"). The crack check rejects board edges and door gaps using depth. Duplicate findings are merged by 3D position. A scan can be **resumed later** by relocalizing with ARKit into the same coordinates. |
| **Technical execution** | End to end: phone scan → live 3D on the laptop → Gemini + YOLO + geometry checks → Atlas → search → move-out comparison → report. |
| **Responsibility: privacy** | Full-resolution originals **stay on the phone**. Only sampled evidence photos and a compact point cloud are uploaded. Dwelld is meant for **empty rooms** at move-in and move-out (say this out loud). Every record and media file is owner-scoped and served `private, no-store`. Room scans aren't public. We don't detect or blur faces; the empty-room rule is the safeguard, and we say so. |
| **Responsibility: honesty about uncertainty** | Every AI finding starts **amber (needs a look)** until a person confirms it, unless the verifier is at least 85% sure (the threshold is configurable). The verifier's verdict and confidence are stored and shown. Rejected crack candidates are reported, not silently dropped. Search shows which index answered and when a fallback was used. The comparison states that "unseen areas cannot establish absence". A missing detection is never presented as "no damage". |

**Models and data sources note (paste into the submission):** Gemini 4 Argon (detection, verification, describe-at-point, comparison, Q&A). gemini-embedding-001. Voyage voyage-4 (via Atlas Automated Embedding), voyage-multimodal-3.5 and rerank-3. YOLO11n (Ultralytics, AGPL-3.0, ONNX in the browser) for object detection on uploaded walkthrough videos. A YOLOv8n-seg crack model (`public/models/CRACK-MODEL.md`) as a crack candidate source, screened by our edge + depth check. Apple RoomPlan (furniture and wall geometry) and ARKit (LiDAR depth, camera poses, world-map relocalization). **Data:** only the user's own phone captures (RGB, LiDAR depth, camera poses). No third-party or open datasets.

## 4. Technology used

- **Phone:** SwiftUI app (`ios/DwelldCapture`, iOS 17), RoomPlan, ARKit (LiDAR `sceneDepth`, `ARWorldMap` save and relocalize), Metal live splat renderer, Keychain QR pairing.
- **Web:** Next.js 15, React 19, TypeScript, Three.js, `@mkkellogg/gaussian-splats-3d` (LiDAR-initialized Gaussian splats), WebRTC with TURN, deployed on Vercel.
- **AI:** Gemini 4 Argon and gemini-embedding-001 via `@google/genai`; Voyage AI (voyage-4, voyage-multimodal-3.5, rerank-3) via the Atlas Embedding API; YOLO11n and the crack model via onnxruntime; our own crack edge + depth check (`sharp`, Sobel, Hough transform, plane-plus-step depth fit).
- **Data:** MongoDB Atlas (M0) with GridFS, Atlas Search, Vector Search, Automated Embedding, `$rankFusion` hybrid search. Better Auth with the MongoDB adapter.
- **Media:** sharp, ffmpeg-static.

## 5. Three-minute video plan

Record the screen at 1080p with a phone overhead or over the shoulder for the scan. Use real inputs only: a real room with real marks. Put a whiteboard or framed picture on the wall so the crack check has something to reject.

| Time | Picture | Voice-over (approximate) | Criteria it covers |
| --- | --- | --- | --- |
| 0:00–0:12 | Title card (deck slide 1), then [Friend's name]'s photo or the charge email, blurred where needed | "[Name] paid £[amount] for a scratch that was already there when he moved in. He had no proof." | Named person, problem |
| 0:12–0:20 | Slide 2: "Scan once. Pin every mark. Prove it later." | "Dwelld turns a two-minute phone scan into evidence." | Clarity |
| 0:20–0:50 | Split screen: phone scanning (over the shoulder) and the laptop room building live in 3D, furniture boxes appearing | "The iPhone's LiDAR measures the room. RoomPlan finds the desk, the wardrobe and the door. The laptop builds it live." | Live demo, real inputs |
| 0:50–1:15 | Amber candidates appear. Click one: evidence photo with box, then the verifier verdict. Show a rejected "crack" on the whiteboard edge with its reason. | "Gemini 4 Argon checks every photo. A second Argon pass argues against each finding, and a depth check throws out fake cracks, like the edge of this whiteboard." | Verification loop, honesty |
| 1:15–1:35 | Phone: crosshair, tap "Mark damage" on a scuff. Laptop: the mark appears, Argon's description fills in. | "If the AI misses something, you tap it. Argon describes exactly what's there." | People in control |
| 1:35–2:10 | `/search`: index panel READY → query "something sticky left behind" → three pipeline columns → fused list with rank bars → vector map with star and lines → 3 s of the Atlas UI | "Everything lives in MongoDB Atlas. Atlas Search, Automated Embedding with Voyage and Voyage photo vectors each rank the evidence, then $rankFusion fuses them. Words find photos." | MongoDB, every feature |
| 2:10–2:40 | Room page → "Continue this scan" → phone relocalizes → comparison view: same item at move-in vs move-out | "At move-out, the phone recognises the room and lines up the new scan. Argon compares both inspections at once: same cabinet, same chip, already there on day one." | Argon long context, usefulness |
| 2:40–3:00 | Slide 3 (tech) for 4 s, then slide 4 (close) | "Built this weekend with Gemini 4 Argon, MongoDB Atlas and Voyage AI. Dwelld doesn't pretend to see everything. It makes every claim checkable." | Disclosure, clarity |

**Live demo (3 min, no slides):** the same order without the slides. Start from a pre-scanned room that is already processed. Continue a small corner live (about 30 seconds of scanning), tap one mark, run one search, end on the comparison. Have the recorded video ready as a fallback if the venue Wi-Fi fails.

**Q&A prep:**
- *Why not just photos?* Photos have no location and no proof they show the same spot. We pin each one in 3D and match it across scans.
- *What if the AI is wrong?* It's a suggestion until a person confirms it. The verifier and the depth check reject a lot, and we show what they rejected.
- *Privacy?* Originals stay on the phone. It's for empty rooms. Everything is owner-scoped.
- *Built before kickoff?* The repo was created Friday 17:11, after hacking started. The first large commit was written with AI coding agents.

## 6. Pre-recording checklist

- [ ] Fill in [Friend's name], the item and the amount everywhere in this file.
- [ ] `VOYAGE_API_KEY` set in Vercel (Atlas → AI Models → create a model API key), then redeploy.
- [ ] `/search` → **Create or update indexes** → all four READY → **Prepare my findings** until 0 remaining.
- [ ] Check the panel says "$rankFusion supported". If it doesn't, the page says the app-side fallback is in use; mention it honestly.
- [ ] Pre-scan the demo room with the **new** iOS build (so it has a world map). Test "Continue this scan" once.
- [ ] A real scuff, a sticker residue and a whiteboard in the room.
- [ ] Watch Atlas storage (M0 is 512 MB). Upgrade with the $100 credit if it's near the limit.
- [ ] Submission text: description, how it meets each challenge (§3), the models note (§3), the repo link and the video link.

## 7. Pitch deck (for the recorded video only)

Four slides, in the website's style: warm paper `#f8f8f3`, ink `#202723`, sage `#dae7da`, terracotta `#c8755b`, serif headings.

1. **Title:** "dwelld." in large serif. Subtitle: "Your room remembers." A full-bleed still of the LiDAR splat of the real room, darkened, with one terracotta pin on a scuff.
2. **The problem:** a photo of [Friend's name]'s item (or the charge email, cropped) on the left. On the right, one line in large serif: "£[amount] for damage that was already there." Small caption: "No location. No timestamp. No proof."
3. **How it works:** a four-step horizontal flow with thin rules and icons. *Scan* (iPhone LiDAR + RoomPlan) → *Check* (Gemini 4 Argon + verifier + depth check) → *Remember* (MongoDB Atlas: Search, Automated Embedding, Voyage photo vectors, $rankFusion) → *Prove* (move-in vs move-out comparison). Partner logos in a quiet row underneath.
4. **Close:** "Every claim checkable: who saw it, where, when, and how sure." A small line with the repo URL and the team names.

Optional fifth slide for the video's MongoDB segment: a screenshot of the `/search` vector map with the star and lines. Use it as a 2-second transition if the live screen recording is too busy.
