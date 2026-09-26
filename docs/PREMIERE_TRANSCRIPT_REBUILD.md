# Transcript interior editing by source rebuild (AA)

AA removes explicitly selected interior transcript ranges by assembling the complementary KEEP ranges as hard-bounded subclips. It uses the existing Y2 subclip correlation and project-item insertion primitives. It does not call or simulate an arbitrary native split.

## Workflow

1. Keep the original sequence active. Supply its exact video track/clip index and the exact project item whose native transcript is being edited.
2. Prepare a **different, explicitly supplied empty destination sequence** in the same project. Inspect it to copy its sequence GUID, then reactivate the original before planning. Both requested video/audio tracks must already exist. The destination must contain no clips and no caption tracks. AA does not activate it or change the original.
3. Call `premiere_plan_transcript_rebuild`. It reads the complete recognized native transcript, resolves stable `seg-0001` IDs, inspects source start/end/in/out/identity and checks the destination. Planning performs no mutations.
4. Review the source/sequence/destination keep ranges. Call `premiere_apply_transcript_rebuild` with the same structured `request`, the exact `plan_snapshot` and the returned source `expected` object. Normal high-risk approval applies.
5. The executor checkpoints the `.prproj`, revalidates the approved snapshot, creates each keep subclip, correlates its new project ID, then inserts it in the destination. Native post-inspection checks exact identity, track and start/end, detects unexpected additional clips, and confirms the original source timeline remains unchanged.

```json
{
  "tool": "premiere_plan_transcript_rebuild",
  "arguments": {
    "request": {
      "schema_version": 1,
      "item_id": "EXACT_NATIVE_TRANSCRIPT_AND_MEDIA_ITEM_ID",
      "source": {"track": 0, "clip_index": 0},
      "transcript_source_offset": 0,
      "removals": [{"start": 10, "end": 15}, {"start": 30, "end": 35}],
      "destination": {
        "mode": "explicit_empty_target_sequence",
        "sequence_guid": "EXACT_DIFFERENT_EMPTY_SEQUENCE_GUID",
        "video_track": 0,
        "audio_track": 0
      },
      "take_video": true,
      "take_audio": true,
      "gap_seconds": 0
    }
  }
}
```

Each removal is either `{ "segment_id": "seg-0002" }` or a complete `{ "start": 10, "end": 15 }` range in **transcript seconds**. There is no automatic selection of mistakes, fillers, or repeated words. Adjacent/overlapping removals are merged without introducing additional padding. All-removed input is a valid zero-piece result: the destination stays empty and the original stays available.

For an inspected 0–60 source range, the example keeps 0–10, 15–30 and 35–60, assembled at 0–10, 10–25 and 25–50 in the destination. `gap_seconds` defaults to zero and allows an explicit 0–60 second gap between pieces.

## Mapping and bounds

The native track item must refer to the exact transcript/source project item. Only ordinary online forward 1x media with matching source and sequence durations is supported. Nested sequences, merged clips, multicam, reverse playback and uncertain speed/mapping are refused. The planner reports both formulas:

`source = sequence - inspected_sequence_start + inspected_source_in`

`source = transcript + explicit_transcript_source_offset`

The transcript/source anchor is supplied explicitly; it is not inferred from sequence time. Source in-points need not be zero. Every removal must lie inside the inspected source range. Invalid input fails; uncertain native mapping returns `supported=false`.

Limits: 128 removal selections, 128 keep ranges, 256 native operations (one create and one insert per piece), 256 recognized transcript segments, 48,000 UTF-8 bytes for the exact plan snapshot, 64 tracks per media kind and 256 inspected clips per sequence. Excessive fragmentation or payload size is refused. The snapshot binds the request, complete transcript, source timeline and empty destination topology.

## Audio, finishing and recovery

`take_video=true` and explicit `take_audio` are required. Audio means audio from this exact source item only; separate externally recorded dialogue is not inferred or linked. The native result must add exactly one video clip and, when requested, one audio clip on the requested tracks. Unexpected multichannel expansion stops as uncertain. Audio-only and independently mapped external audio rebuild are not implemented.

The rebuilt timeline is a **source-content edit**: timeline effects, keyframes, transitions, graphics and markers are not copied from the original. Inspect the new sequence and use existing finishing/review tools with fresh expectations afterward. W2 interior-cut plans now offer AA as an explicit alternative; direct edge-safe W2 edits remain available. Z edit-job integration is deferred to AF.

`premiere_cancel_transcript_rebuild` stops before the next native operation, including between subclip creation and insertion. Audit entries record each dispatch/result without transcript text. A failed or uncertain operation stops the run, preserves earlier receipts and is never retried. Checkpoint, prepared plan, per-piece source/destination ranges, created subclip IDs, inserted clip receipts, durations, cancellation and uncertainty are returned in the result. An incomplete destination and unused created subclips may remain. Inspect them before preparing a new destination; no automatic rollback is claimed. Lost begin/release delivery or a failed session release may require reloading the paired panel; never resume an old cursor after reload.

The source remains active throughout. Native inspection and separate transactions do not provide an atomic lock across the whole workflow. Avoid editing either sequence during the run. Post-inspection is timing/identity evidence, not a rendered image or audio quality check.

## Official API evidence and verification

- [Adobe ClipProjectItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem): `createSubClipAction(name, startTime, endTime, hasHardBoundaries, {takeVideo, takeAudio})`, stable **26.3+**. The workflow requires this method and inspects ordinary-media state.
- [Adobe SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor): existing `createOverwriteItemAction` handles placement through the shared insertion primitive, stable 25.6+.
- [Adobe VideoClipTrackItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem): source in/out, sequence start/end, speed, reverse and project identity reads support mapping.
- [Adobe Project](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project) and [Sequence](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence): sequence enumeration, exact GUIDs, tracks and transactions. No new beta API dependency or native split is used.

29 new executable Node tests cover planning, bounds, offset mapping, exact snapshot drift, native-mock correlation/insertion, explicit audio, original preservation, partial failure and uncertainty. Six Rust unit tests cover typed input and cooperative cancellation/failure behavior; Cargo is unavailable locally, so those tests and Rust compilation are **unverified**. Runtime verification in real paired Premiere remains **0%**; production ready: **no**.
