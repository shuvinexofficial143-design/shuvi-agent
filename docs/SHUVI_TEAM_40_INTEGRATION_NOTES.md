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


## Milestone 2: native project lifecycle and safe project saves

Implemented official Premiere UXP 25.6+ Project.createProject / Project.open as two **High risk, separately owner-approved** typed actions:
- premiere_create_project: new absolute .prproj destination only. Rust rejects an existing destination/link, dot traversal, reparse-point parents and invalid paths. UXP creates, explicitly saves, and reads back the active project GUID/path. Rust independently fingerprints a newly persisted .prproj. Both host and disk proofs must agree.
- premiere_open_project: requires a nonempty existing .prproj. UXP opens and reads the active project identity, without implicitly saving or closing an existing project; Rust fingerprints before/after to ensure same bytes. This does NOT verify timeline edits or relinked footage.
- premiere_save_project: now creates a unique durable Shuvi Backups checkpoint BEFORE requesting a save. Failed checkpoint prevents save; existing independent persistence proof remains mandatory. Backup protects prior on-disk project, not unsaved in-memory Adobe edits.

### Shared wiring overlap for integrator

src-tauri/src/lib.rs: one module declaration, two ToolAction variants, two tool-catalog entries, two High-risk parsing arms, two runtime dispatcher arms, and a pre-save checkpoint call plus response field in the existing Save arm. src-tauri/src/premiere_bridge.rs: only two fixed allowlist strings. Editing engine logic is isolated in src-tauri/src/premiere_project_lifecycle.rs and integrations/premiere-uxp/project-lifecycle.js. No generic Rust scheduler, approval ledger, native worker, or other feature branch changed.

Important: Rust preflight and Adobe's subsequent pathname-based project creation are not atomic; external writers could create a conflicting file during the gap. Never promise collision immunity or safe automatic retry. Rust's existing UUID audit and exclusive Windows mutation lane stay authoritative. This is source/mock-host tested, NOT live verified.

Tests cover clean absolute Windows paths, reject overwrite, independent disk readback, host create and save, host open without implicit save/close, wrong active host identity and changed files. Runtime validation on a disposable authorized Windows Premiere installation is still required, as is a real project reopen and media relink check.

Official Adobe Project UXP API reference: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project

## Milestone 3 — source-bound relink, saved project durability, media audit

This extends the existing Premiere native editing pipeline, not a parallel UI clicker.

- Read-only tool: premiere_media_audit. The paired UXP panel traverses the active project in a bounded manner (maximum 1,000 visited items, 500 reported clips, 8 nested folders). Returns exact native itemId, mediaPath, offline state, project GUID/path and scanComplete. Incomplete/unknown inventories never become blanket editing authorization.
- High-risk existing premiere_relink_media now requires expected_previous_path (copy the exact path from an actual inspection). The UXP panel checks the currently resolved project item ID and media path before performing any mutation and refuses no-op or stale source requests.
- The local Rust host independently SHA256-hashes the replacement media before the approved edit, immediately after the edit, and after project save. Only nonempty, regular, non-symlink local files within a bounded 4 GiB budget may be hashed. This detects changes; it does not prove media codec decode or semantic suitability.
- Prior project save/checkpoint happens before the media mutation. After exact successful UXP item/path/online readback, the same approved native action saves the active .prproj and independently fingerprints its on-disk bytes. The tool subsequently reinspects the active project/sequence and exact media item, requiring the new path and offline=false, as well as file SHA256 continuity and independently observed disk persistence.
- If any check after Adobe mutation is uncertain, no automatic retry occurs. Shuvi leaves a unique existing backup and explicitly reports whether post-relink save was performed; the user can inspect the project and backup before another decision.
- This is not a successful fresh-session reopen acceptance. To validate across a fresh session, explicitly reopen the saved project using premiere_open_project, then run premiere_media_audit / premiere_inspect_media_interpretation, matching the exact expected project GUID/item and media path. A fresh open does not automatically validate visual frames or an exported MP4.

The existing native permission lease, audit receipts and risk confirmation remain unchanged. The new read-only media inventory is not write authorization. The existing PremiereRelinkMedia variant now carries expected_previous_path. Update proposals/client tests that previously supplied just item_id/new_path; do not silently default to a stale or unknown source path.

Source mock fixtures: scripts/premiere-media-relink-durability.test.mjs. Rust SHA256 unit tests are in src-tauri/src/premiere_media_relink.rs. Existing Premiere transport and speed VM fixtures were extended for the newly added UXP modules; earlier frontend CI failures were caused by old fixed mock module allowlists, not by Windows Rust compilation. Full exact-head CI and Windows Adobe live acceptance must still be reported separately.

Known limitations: file-path preflights and Adobe operations do not provide an atomic OS-wide lock. Large media over 4 GiB is rejected by this strict proof workflow. A successful native path readback is not proof of correct video frames, linked audio, source interpretation, relinked proxy health, export completion or new-session reopen.

## Milestone 4 — independent verification after a separately approved project open

New read-only premiere_verify_saved_media tool accepts exact previously recorded saved project path, project GUID, project FNV1a64 fingerprint (16 hex), native item ID, replacement media path and SHA256 (64 hex). The operator can call premiere_open_project first, then premiere_verify_saved_media.

The tool independently re-fingerprints .prproj and media files before and after bounded paired UXP inspections, then compares all four gates: current host project identity, exact on-disk project fingerprint, exact replacement media SHA256 and online native item path/identity. The tool never opens/closes/saves/edits media; fresh_session_proven remains false because a standalone read-only scan cannot prove a separate process/session actually reopened the project. A prior audited premiere_open_project establishes separate open action evidence; a real host run is still needed.

New Rust tests for assess_saved_media reject changed SHA and still-offline footage. Node source tests verify that no hidden host mutation occurs in the read-only execution arm. Windows/Adobe host performance and true playback semantics are unverified until authorized acceptance.

## Milestone 5 — Exact-MOGRT source handoff and MP4 delivery probe

A. **Source-bound MOGRT editing**: Use the new read-only premiere_inspect_mogrt_artifact on an existing .mogrt (up to 256 MiB) to obtain its exact SHA-256, then copy that hash into a separately owner-approved premiere_insert_verified_mogrt request. The latter requires the exact inspected Premiere project and sequence GUID, checkpoints the previous .prproj, hashes the MOGRT both before and immediately after checkpoint, inserts via the native UXP SequenceEditor.insertMogrtFromPath, and requires a genuine new native track-item identity. Only after this readback does it save the edited project and independently assess changed project bytes and the MOGRT source hash again. Uncertain insertions are never auto-retried and do not trigger an automatic post-insertion Save. Existing generic premiere_insert_mogrt_path remains available with its original contract.

This binds MOGRT file bytes and Premiere's new clip identity; it DOES NOT attest that Adobe After Effects created the file, that the Essential Graphics controls work, that effects render correctly, or that the user accepts the aesthetic result. An AE export_mogrt receipt, if available, must be separately checked for actual AE-origin provenance. A verified project save is not a successful reopen/playback.

B. **Read-only final MP4 media probe**: premiere_inspect_final_delivery requires a previously recorded Premiere export job UUID plus its exact expected project and sequence GUIDs. It only reads that job's .mp4 output, hashes it before/after, runs the existing bounded ISO BMFF parser and trusted ffprobe metadata probe when available, and returns independently categorized fields for file stability, structure and stream metadata. Unknown or unsupported files fail closed. This action does not start encoding, modify a job store, or grant extra permissions. Export origin attribution, full decode, actual playback and separately confirmed Premiere/AME encoder completion remain false; even a structurally valid MP4 MUST NOT be declared a completed delivery without those additional host checks.

Code boundaries: src-tauri/src/premiere_mogrt_handoff.rs and src-tauri/src/premiere_final_delivery.rs are standalone Rust contracts; only Adobe-specific ToolAction enum/catalog/execute/parser arms were added to shared src-tauri/src/lib.rs. UXP insertMogrtFromPath, before/after graphicsTrackSnapshot and verifyDirectMogrtInsertion are reused unchanged. Existing After Effects/other teams' code and scheduler are not modified.

Node source test suites: scripts/premiere-mogrt-handoff.test.mjs (8 contract assertions) and scripts/premiere-final-delivery.test.mjs (6 contract assertions). Rust unit tests directly validate matching/changed file hashes, invalid MOGRT requests, mismatched export-job identities and refusal to promote a parsed MP4 to confirmed encoder completion. Exact-head GitHub Actions must be separately checked; these tests and source code do not provide live Windows Adobe acceptance. 
