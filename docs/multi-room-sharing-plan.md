# Multi-room Spaces and shared inspections

Dwelld groups a property under a **Space**, with separate room records, check-in and check-out inspections, and invitations.

## Implemented on this feature branch
- Create a Space, open its own overview page, add or assign rooms, and retain existing ungrouped rooms.
- Invite a tenant or landlord by email-bound, seven-day, one-use URL. Copy it to the intended recipient; no automatic outgoing email is configured.
- The invited person signs in using that email, accepts the invitation and sees shared spaces/rooms on their dashboard. The owner can remove members or revoke pending links.
- Members can start their own video or paired LiDAR inspections of shared rooms, review their own findings, and see the other party's stored scans, source video, spatial assets, reports and comparisons.
- Members can compare two finished scans of one shared room regardless of which participant created them. Comparison reviews retain reviewer identity and history. Destructive inspection edits remain reserved for the scan creator.
- Space owner retains project administration, and deleting a room is blocked if it contains a different member's inspections. After revocation, people cannot read the other party's private evidence, although they retain access to their own scan records.
- Measured door planes plus timestamped ARKit camera trajectories generate likely doorway crossings. The scan creator can confirm, reject, and rename those proposed room boundaries in the spatial workspace. Geometry and media remain unmodified.

## Still requiring native/device integration and validation
A confirmed suggested doorway is saved as a section of the existing scan. It does **not** yet cut a global Gaussian PLY into independently aligned room splats or automatically create a new live RoomPlan capture/session at the doorway. To give a second room its own move-in/move-out scan today, create that room in the Space and capture it with its own scan. Fully continuous multi-room native capture requires implementing RoomPlan multiroom structure coordination and verifying on actual LiDAR hardware, alongside per-room evidence partitioning and shared-media deletion/reference counting. No claim of those steps being complete is made.

## Security and acceptance checks
Verify a landlord can accept only an invitation addressed to their signed-in email; revocation immediately blocks read of the other participant's room/inspection/video/asset/report; scan creators retain their own evidence; non-members cannot read a space. Run concurrent invite acceptance, scan and comparison mutations, media-range playback, and the existing single-room regression suite. `npm ci && npm run lint && npm test && npm run build`; run the iOS target with Xcode on LiDAR hardware. Vercel preview and a source review are not substitutes for a real-device test.
