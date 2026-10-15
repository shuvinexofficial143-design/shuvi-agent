# Shuvi Team 40 — Premiere media/sequence workflow integration

## Exact ownership and change boundary

Base: `99c9e58ef0e43139edfe2d6464f6411be47e1aa0`.
This feature branch changes only Team 40-owned `integrations/premiere-uxp/main.js`, adds `integrations/premiere-uxp/media-workflow-evidence.js`, and adds `scripts/premiere-media-workflow-evidence.test.mjs`. No edits to shared `src-tauri/src/lib.rs`, schedulers, native action permission/audit, or other teams' modules.

`main.js` is an existing Adobe host-bridge wiring file. Exact touched functions: `importMedia`, `findClipItemsForPaths`, and `createSequenceFromMedia`; new read-only `inspectNewSequenceTimeline`; new helper import near the top. These are the only potential same-file integration conflicts.

## Functional behavior

- Reject malformed, relative, silently filtered or normalized-duplicate media paths before invoking Adobe.
- For `import_media`, inspect the project's native file inventory before mutation, import only currently missing paths, and verify every requested path against a complete post-import native inventory. Block when preflight inventory is truncated or existing paths are ambiguous. A no-op import reports `imported:0` and `alreadyPresent`; it does not claim new bytes were imported.
- For `create_sequence_from_media`, reject ambiguous project media IDs before sequence creation. After creating the native sequence, independently inspect its native video/audio track items. Verify bounded inventory, requested media-ID coverage, positive clip durations, temporal order, and no unexpected project items in the new sequence. A new GUID alone no longer means successful timeline creation.
- If native readback fails after creating a sequence, return `accepted_unverified`, `uncertain:true`, `retrySafe:false`; do not automatically recreate. The existing Rust receipt check continues to require `verificationStatus=verified_readback`. Existing backup, native permissions, source hash and Rust action UUID remain authoritative.
- Readback intentionally limits itself to 24 tracks and 240 items. Larger/complex timelines remain unverified rather than being misrepresented as complete. Media API semantics require real host acceptance before describing the result as Live Verified.

## Cross-team contract

- Team 37: `premiere_import_media` result adds `alreadyPresent` and `duplicatePaths`; `premiere_create_sequence_from_media` adds `timelineContentVerified` and `timelineEvidence`. Do not treat project GUID or `created:true` as edit completion. Never auto-retry uncertain mutations.
- Team 38: existing Rust native exclusive desktop lease and audit UUID remain unchanged. Do not infer auto-retry from a read-only no-op import result.
- Team 39: exact Adobe project/sequence identities still come from the existing paired UXP bridge, not generic screenshot text.
- Team 41: producer media still requires real path/hash provenance and Rust's existing `expected_sha256` source check.

## Test and live evidence

`scripts/premiere-media-workflow-evidence.test.mjs` tests executable helper logic and runs the actual extracted UXP import/sequence functions against deterministic mock host fixtures: import only missing media; no duplicate import; fail-closed incomplete/ambiguous scans; correct new sequence track inventory; missing or disordered clips remain unverified; reject duplicate source requests before host mutation.

These are source/mocked-host tests, **not** real Premiere/After Effects host acceptance. An owner-authorized disposable Windows/Premiere project is still required to verify native API behavior, persistence/reopen, real media relink, actual exported MP4 validation and editing quality. No host, Adobe installation, customer project, production deployment, or paid AI action was touched.
