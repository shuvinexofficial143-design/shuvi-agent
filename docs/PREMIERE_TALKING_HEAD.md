# Premiere talking-head transcript editing (W2)

W2 converts **explicit transcript selections** into bounded Premiere edits. It does not decide which words are bad, infer linked A/V membership, or fabricate a split operation that the current typed timeline layer cannot prove safe.

## 1. Plan explicit transcript selections

Use `premiere_plan_transcript_cuts` with a real transcript project item and exact timeline targets:

```json
{
  "tool": "premiere_plan_transcript_cuts",
  "arguments": {
    "request": {
      "schema_version": 1,
      "item_id": "EXACT_TRANSCRIPT_PROJECT_ITEM_ID",
      "video": {"kind": "video", "track": 0, "clip_index": 0},
      "audio": {"kind": "audio", "track": 0, "clip_index": 0},
      "transcript_offset_seconds": 10,
      "padding_seconds": 0.05,
      "ripple": false,
      "selections": [
        {"segment_id": "seg-0001", "action": "remove"},
        {"segment_id": "seg-0003", "action": "chapter", "label": "Part 2"},
        {"segment_id": "seg-0004", "action": "highlight"}
      ]
    }
  }
}
```

The tool exports the current native transcript, requires complete recognized timing, inspects the active timeline, and returns:

- a deterministic segment catalog (`seg-0001`, `seg-0002`, ...)
- a deterministic `transcript_snapshot`
- mapped sequence-time ranges
- exact edge-trim or whole-clip delete operations when safe
- Chapter/Comment marker operations
- explicit unsupported reasons

`transcript_offset_seconds` is required because transcript time is not silently assumed to equal sequence time.

## 2. What cuts can execute today

The typed Premiere layer currently supports safe trim/delete primitives but does not expose a verified split-at-playhead primitive. Therefore W2 executes:

- removal touching the clip start -> trim start
- removal touching the clip end -> trim end
- removal covering the whole exact clip -> delete
- chapter/highlight selections -> marker creation

An interior removal that would create a hole in one clip returns `supported=false` with a split-path requirement. It is **not** approximated with destructive UI clicks.

Padding is explicit and bounded to 0–2 seconds. Overlapping remove ranges are merged deterministically.

## 3. Audio/video safety

W2 never infers that clips are linked. If both video and audio should be edited, both exact targets must be supplied and both must have fresh expectations.

The inspected video/audio intervals must match. Ripple deletion with separate video+audio targets is refused because sequential ripple operations could shift the other target while native linked membership remains unverified.

## 4. Apply a previously planned cut

Copy the exact `transcript_snapshot` returned by the plan and fresh target expectations:

```json
{
  "tool": "premiere_apply_transcript_cuts",
  "arguments": {
    "request": {
      "schema_version": 1,
      "item_id": "EXACT_TRANSCRIPT_PROJECT_ITEM_ID",
      "video": {"kind": "video", "track": 0, "clip_index": 0},
      "audio": {"kind": "audio", "track": 0, "clip_index": 0},
      "transcript_offset_seconds": 10,
      "padding_seconds": 0.05,
      "ripple": false,
      "selections": [
        {"segment_id": "seg-0001", "action": "remove"},
        {"segment_id": "seg-0003", "action": "chapter", "label": "Part 2"}
      ]
    },
    "transcript_snapshot": "COPY_EXACT_PLAN_SNAPSHOT",
    "expected": {
      "project_guid": "COPY_PROJECT_GUID",
      "sequence_guid": "COPY_SEQUENCE_GUID",
      "clips": [
        {"kind": "video", "track": 0, "clip_index": 0, "signature": "COPY_VIDEO_SIGNATURE"},
        {"kind": "audio", "track": 0, "clip_index": 0, "signature": "COPY_AUDIO_SIGNATURE"}
      ]
    }
  }
}
```

Apply re-exports the transcript and fails before editing if its snapshot changed. It also reinspects the exact clips and signatures.

A durable `.prproj` checkpoint is taken before the first mutation. Native edits reuse the existing `trim_clip` / `delete_clip` routes. Markers reuse `add_marker`. Unknown/timeout delivery stops the workflow; there is no blind retry.

## 5. Transcript-driven audio finishing

This module complements the existing:

- `premiere_plan_transcript_ducking`
- `premiere_apply_transcript_ducking`
- `premiere_plan_audio_automation`
- `premiere_apply_audio_recipe`

Those tools already derive speech regions from recognized transcript timing and can apply inspected music ducking/fades. W2 does not claim VAD, loudness normalization, or assumed dB units.

## Current limitation

Mid-clip text-based deletion still needs a verified native split path before Shuvi can remove arbitrary interior transcript ranges end to end. W2 deliberately fails closed rather than simulating a split with blind coordinates.
