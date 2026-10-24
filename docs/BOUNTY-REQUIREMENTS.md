# Encode London 2026: bounty requirements (reference)

Copied from the official programme page on 24 October 2026: https://www.encodeclub.com/programmes/encode-london-2026. Check the page again before submitting in case anything changed. Our pitch and how we meet each point are in [`PITCH.md`](../PITCH.md).

## General rules (all tracks)

- **Deadline:** submit on the Encode platform before **Sunday 25 October, 12:00 London time**. The event ends at 16:30.
- **Every submission needs:**
  - a project description
  - an explanation of how it meets **each** challenge entered
  - a link to the code repository
  - a demo video
- **One project per team.** It can be entered into several challenges and bounties if it meets each one's requirements. Each bounty is judged separately.
- **Judging:** partner bounties (Google DeepMind, MongoDB, Saint) are judged by each partner. Open challenges (The Real World, Agents That Ship) are judged by an external panel. Winners are announced at the closing ceremony.
- **Teams:** solo or team, no size limit stated.
- **Overall top three** also win Treg credits ($500 / $250 / $100).

We are entering **Google DeepMind**, **MongoDB** and **The Real World**. One 3-minute video satisfies all three: Google DeepMind and MongoDB ask for 3 minutes, The Real World asks for 2–4.

---

## Google DeepMind: Build with Gemini 4 Argon

**Brief:** a working app or autonomous agent powered by `gemini-4-argon` that solves a specific problem for **a real person you can name**. Our fit is Pathway 2: "The Real World, Hard Tech & Multimodal Creation (voice, video, 3D/WebGPU and physical systems)".

**Prizes:** $15,000 in Gemini API credits (1st $7,000, 2nd $5,000, 3rd $3,000).

**Judging** (3-minute live demo plus 2 minutes of Q&A, no slide decks):

| Weight | Criterion | Exact questions judges ask |
| --- | --- | --- |
| 50% | Working live demo | Does it run live with real inputs in under 3 minutes? Did the team use gemini-4-argon, Managed Agents or companion models effectively, **with a real verification loop**? |
| 25% | Problem and usefulness | Does it solve a concrete problem for **a specific person you can name**? Could it grow into a product or open-source tool after the hackathon? |
| 15% | Originality / needs Gemini 4 Argon | Is it only possible because of Argon's 1M unified context, long decode, frontier reasoning, agentic video analysis, 3D/WebGPU generation or multi-agent orchestration? Does it **keep people in control** of actions that affect external systems, money or private data? |
| 10% | Clarity of pitch | Did the team show who the user is and demo the working product clearly in 3 minutes, without slides? |

**Disqualified or low-scoring:**
- A basic chat wrapper or Q&A bot over a single PDF.
- A static page with no autonomous reasoning, verification loop or multimodal workflow.
- An unverified medical, mental-health or financial advice bot without human-in-the-loop safeguards.
- **Anything built before kickoff.** Libraries and templates are fine, but the demo must only show code written during the hackathon.

**Submission requirements:**
- [ ] GitHub repository
- [ ] 3-minute demo video, plus a live demo for the judges
- [ ] A statement of **which Gemini models and agents we used and how**

**API rules:** use `thinking_level` (low / medium / high), not `thinking_budget`. Remove `temperature`, `top_p`, `top_k` and explicit `cached_content`. Use SDK `@google/genai` 2.3.0 or later. The Interactions API is recommended but not required.

---

## MongoDB: Build Anything, Change Everything with MongoDB Atlas

**Brief:** an application that solves a real-world problem with MongoDB Atlas as its foundational backend data store.

**Requirements:**
- [ ] The app relies on an Atlas database for its core functionality.
- [ ] It uses **at least one** of the features below. **The more, the more points.**
  - Atlas Search (text search)
  - Atlas Vector Search
  - Hybrid Search
  - Automated Embedding
  - Atlas Stream Processing
  - Voyage AI by MongoDB models (some are already part of Automated Embedding)

**Prizes:** to be announced. Every participant gets $100 of Atlas credit at the MongoDB booth.

**Submission requirements:**
- [ ] GitHub repository
- [ ] 3-minute demo video showing **the app in action and MongoDB in use**

---

## The Real World: AI that understands the world around us (open challenge)

**Brief:** software that makes sense of the physical world from photos, audio, maps and open data. Phone sensors, cameras and your own photos or recordings are explicitly allowed.

**Judging:**

| Criterion | What judges look for |
| --- | --- |
| Real-world usefulness | A clear user and a problem that exists outside the hackathon. |
| How well it reads the world | Accuracy, and sensible handling of messy inputs (blurry photos, background noise, gaps in data). |
| Technical execution | A working end-to-end demo that combines AI models with real data. |
| Responsibility | Respect for privacy (faces, number plates, people's locations), and **honesty about uncertainty** when the model isn't sure. |

**Submission requirements:**
- [ ] Working demo (web, mobile or hardware)
- [ ] Code repository with a README and setup instructions
- [ ] 2–4-minute demo video on **real inputs** (photos, recordings or live data)
- [ ] A short note on the **models and data sources** used

---

## Not entered

- **Agents That Ship:** needs an agent that completes a multi-step job end to end with tool use. Dwelld is an inspection app, not that.
- **Saint:** needs a Saint AI agent doing the work in the demo. We don't use Saint.
