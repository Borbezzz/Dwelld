# Multi-room spaces and shared inspections

## Product flow
A **Space** is one property (for example, "Flat 12"). It owns several rooms, each retaining its own scans, coordinate origin, evidence, and existing move-in/move-out comparison. Existing single rooms stay valid with `spaceId: null`. The first safe backend slice adds `/api/spaces`, optional `spaceId` when creating a room, and `PATCH /api/rooms/:id` to attach/detach an existing owned room.

## Next UI slice
Dashboard -> property list -> room list, with room name editable. For a native scan, suggest "Room 1", "Room 2" and so on; allow rename. Treat an ARKit/RoomPlan doorway as a *candidate boundary* when its doorway plane is crossed by a stable tracked camera trajectory and enough samples exist on both sides. Prompt "New room?" and allow merge/undo. Do not infer adjacency based solely on seeing a door; a door may be a wardrobe or exterior entrance. Persist room-to-room edges and alignment metadata. Multi-room splitting needs native tests, saved per-room spatial manifests/segmentation, and a clear scan-origin strategy. Never cut a PLY blob at arbitrary offsets.

## Sharing architecture, before exposing UI
Sharing is **not enabled by this slice**. The existing system authorizes evidence, media and all mutations using `ownerId`. A safe invitation must instead introduce explicit `spaceMembers` with owner, landlord and tenant roles, a scoped invite token stored hashed and expiring, accept/revoke/audit endpoints, and a central read/write permission helper applied to rooms, inspections, findings, live sessions, comparisons, reports, private media and search. Ownership is retained for billing/deletion. No public bearer media URLs.

Recommend explicit permissions: owners manage membership; members can create their own check-in/check-out inspection for rooms in the Space, see shared scans and evidence, and review their own findings. A signed-off snapshot should be immutable with timestamp, actor, evidence references and revision history; disagreements remain separate observations, never silent edits to the other party's evidence. Sharing is optional and requires explicit consent.

## Rollout and verification
1. Create a Space and add an existing and a new room; confirm old ungrouped room works unchanged.
2. Check wrong-account space assignment returns 404; invalid IDs return 400; ensure room/list serialization is consistent.
3. Implement dashboard grouping, then multi-room detection on a LiDAR device with doorway boundary confirmation and room-specific capture uploads.
4. Build membership/invitation and audit every auth/media route as one feature before enabling any landlord-facing controls.
5. Test tenant and landlord access, revocation (including media and cached client data), account isolation, conflicting check-in/out claims, and ownership/deletion paths.
