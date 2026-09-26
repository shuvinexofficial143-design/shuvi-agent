# Premiere native Scene Edit Detection (AB)

Shuvi exposes Premiere's stable native Scene Edit Detection through explicit, bounded video targets. The implementation uses Adobe's documented `SequenceUtils.performSceneEditDetectionOnSelection` API with `Constants.SequenceOperation.APPLYCUT` or `Constants.SequenceOperation.CREATEMARKER` (introduced in Premiere UXP 25.6).

## Tools

- `premiere_plan_scene_detection` — read-only capability/timeline verification and exact target expectation generation.
- `premiere_detect_scene_markers` — marker-producing native Scene Edit Detection.
- `premiere_detect_scene_cuts` — destructive native cut detection.

Each request contains 1–16 exact video targets with the current inspected `targetSignature`.

## Selection safety

The UXP panel snapshots the current sequence selection, resolves only the requested video clips, sets an exact temporary `TrackItemSelection`, dispatches one native Scene Edit Detection call, then attempts to restore the prior selection. Selection restoration failure is reported; it is not hidden or retried.

Desktop expectations cover every target before the command can reach the host.

## Verification

A native `true` return is not treated as sufficient proof of the requested result.

For cut mode Shuvi compares bounded video-clip counts and correlates same-media pieces on the original track/range. It derives at most 256 scene segments.

For marker mode Shuvi observes both sequence markers and source-project-item markers. Source marker times are mapped back to sequence time only for ordinary 1x targets with inspected source in/out timing. If a marker cannot be grounded to sequence time, it is still reported as a native marker delta but is not fabricated into a scene boundary.

Result states include:

- `verified_delta` — a bounded observable marker/timeline delta was found.
- `accepted_unverified` — Premiere accepted the native call but Shuvi could not observe a qualifying delta.
- `native_rejected` — Premiere returned false.

`runtimeVerified` remains false until the repository's real paired-host acceptance process records evidence; structural/mock tests never promote runtime status.

## Mutation safety

Both marker and cut execution use the normal project/sequence/clip expectation path. Mutating execution takes a durable `.prproj` checkpoint before dispatch. Cut mode is high risk; marker mode is medium risk. Neither mode is blindly retried after a timeout or uncertain delivery.

The Scene Edit Detection call itself is a single host operation, so cancellation cannot safely interrupt it after dispatch. Shuvi therefore validates everything before the call and reports uncertainty honestly if result delivery is not confirmed.

## Review integration

The native result contains up to eight representative scene midpoints in `reviewTimes`. Call the existing `premiere_review_frames` tool explicitly if visual review is desired. Scene detection does not automatically ask vision to reinterpret or mutate the edit.
