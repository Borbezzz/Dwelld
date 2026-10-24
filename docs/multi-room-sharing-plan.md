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
Confirmed doorway crossings can be materialized into linked room records inside a Space. Each child room reuses the original capture and its own timestamped RGB frames and findings, without duplicating a Gaussian PLY or deleting the original data. Child rooms can then receive later, independent check-out scans, and comparison uses the section time range. The displayed reconstruction still uses the global splat and geometry; it is not cropped to each room. Live in-scan room switching and true per-room segmented splat reconstruction remain native-device work, and must not be claimed as done.

## Security and acceptance checks
Verify a landlord can accept only an invitation addressed to their signed-in email; revocation immediately blocks read of the other participant's room/inspection/video/asset/report; scan creators retain their own evidence; non-members cannot read a space. Run concurrent invite acceptance, scan and comparison mutations, media-range playback, and the existing single-room regression suite. `npm ci && npm run lint && npm test && npm run build`; run the iOS target with Xcode on LiDAR hardware. Vercel preview and a source review are not substitutes for a real-device test.
