# Premiere professional edit jobs (Z)

Professional edit jobs compose Shuvi's **existing real Premiere tools** into one project/sequence-scoped workflow. The job coordinator does not contain a second hidden editing engine: every mutating phase is returned as one concrete typed tool proposal and still passes through normal Shuvi approval, checkpoint, expectation and audit handling.

## Supported job types

- `talking_head`
- `social_reel`
- `product_ad`
- `wedding_highlight`
- `corporate`
- `custom`

The type labels do not unlock unsupported effects. Actual behavior comes only from the explicit assembly, transcript-cut, finishing, review and export payloads supplied in the job.

## Tools

- `premiere_edit_job_start` — bind a validated job to the currently active project and sequence.
- `premiere_edit_job_status` — read persisted phase state.
- `premiere_edit_job_next` — revalidate the live project/sequence and return exactly one concrete existing typed tool proposal.
- `premiere_edit_job_record_action` — advance only after a matching recent audit receipt for that exact phase tool.
- `premiere_edit_job_cancel` — cancel pending phases without pretending to undo completed edits.

## Phase order

Only phases present in the request are created:

1. assembly → `premiere_apply_assembly`
2. transcript cuts → `premiere_apply_transcript_cuts`
3. mixed finishing → `premiere_finish_media_batch`
4. review → `premiere_review_frames`
5. export preflight → `premiere_plan_export`
6. export dispatch → `premiere_export_sequence`

Graphics, music and transitions can already be inside assembly v2. Audio/video/graphics finishing can already be inside X2 mixed finishing.

## Fresh target binding

The coordinator never silently reuses stale clip signatures after earlier phases:

- Before transcript-cut execution it re-exports the native transcript, reinspects the timeline, rebuilds the W2 cut plan, stores the current transcript snapshot, and generates exact current clip expectations.
- Before X2 finishing it reinspects the timeline and creates exact expectations from current native target signatures.
- Assembly and export use the current job project/sequence identity.

If the active project, path or sequence changes, `next` and receipt recording stop.

## Approval model

`premiere_edit_job_next` **does not execute** the returned phase. It returns a normal Shuvi tool proposal with `requires_separate_approval=true`. After that real tool is executed, pass its audit action ID to `premiere_edit_job_record_action`. This preserves phase-by-phase user approval and avoids a hidden mega-executor.

The audit record proves the typed tool ran successfully, but the legacy audit entry does not cryptographically hash every phase argument. Downstream Premiere expectations and transcript snapshots still guard native stale targets.

## Export semantics

Export preflight and export dispatch are separate phases. A successful dispatch ends an export-enabled job in `export_dispatched`, not “render verified”. Encoder/file completion remains governed by the existing export status/readiness subsystem.

## Example

```json
{
  "tool":"premiere_edit_job_start",
  "arguments":{
    "schema_version":1,
    "job_type":"corporate",
    "assembly":{
      "schema_version":2,
      "shots":[
        {
          "item_id":"EXACT_PROJECT_ITEM",
          "timeline_seconds":0,
          "video_track":0,
          "audio_track":0,
          "mode":"overwrite",
          "role":"a_roll"
        }
      ],
      "review":false
    },
    "transcript_cuts":null,
    "finishing":null,
    "review":{
      "seconds":[1,5],
      "prompt":"Check framing, graphics consistency and visible edit discontinuities."
    },
    "export":{
      "output":"C:/Exports/corporate.mp4",
      "preset":null,
      "queue_to_ame":false,
      "overwrite":false
    }
  }
}
```

Call `premiere_edit_job_next`, execute the returned concrete proposal through the normal Shuvi permission flow, record its audit action ID, and repeat until the job is complete or export has been dispatched.


## AF advanced phase integration

Professional edit jobs can now opt into the real AA–AE capabilities without introducing a hidden mega-executor. Optional phases are:

- `media_prep` → `premiere_prepare_media_batch`
- `scene_detection` → native scene cuts or scene markers
- `transcript_rebuild` → `premiere_apply_transcript_rebuild`
- `track_organization` → `premiere_organize_tracks`
- `layering` → `premiere_layer_clips`
- `work_area` → `premiere_set_work_area`
- `frame_delivery` → `premiere_export_review_frames`
- `interchange_export` → one explicit AAF/FCPXML/OTIO typed tool

The existing assembly, direct transcript cuts, finishing, review and normal media export phases remain available.

### Talking-head strategy

A rebuild job must explicitly select `talking_head_strategy: "source_rebuild"`. Direct W2 cuts and AA source rebuild are mutually exclusive inside one job. Existing direct-cut jobs remain backward compatible when no strategy field is supplied; Shuvi never silently changes an edge-cut job into a rebuild.

### Fresh phase binding

`premiere_edit_job_next` still returns only one separately approved typed proposal. Before clip-sensitive advanced phases it rereads current native state:

- scene detection rechecks capabilities and the current timeline, then rebuilds exact expectations;
- transcript rebuild reruns the read-only AA plan immediately before approval and uses the fresh `plan_snapshot`/expectation;
- layering reinspects the current timeline and refuses a source whose stored signature no longer matches;
- direct transcript cuts and X2 finishing keep their existing fresh transcript/timeline inspection paths.

This means earlier edits do not silently authorize later work against an old expectation. Where Shuvi lacks a stable identity needed to relocate a moved clip, it fails closed instead of guessing a new index.

### Delivery choice

A job may select at most one primary delivery path:

- regular media export,
- native review-frame package,
- one interchange export (AAF, FCPXML or OTIO).

Each delivery remains its normal separately approved Shuvi tool. No job silently exports every format.


## Iterative review/correction phase

A review phase may opt into the bounded correction loop:

`{"seconds":[1,5],"prompt":"Check framing and graphics","iterative":true,"max_iterations":4,"reference":"optional brief"}`

In this mode the job phase uses `premiere_review_session_start` instead of the one-shot `premiere_review_frames`. The start receipt alone cannot complete the job phase. Run `premiere_review_session_continue` through its separately approved correction/re-review cycle, then call `premiere_edit_job_record_review` with the completed review-session ID.

The recorder rechecks the current project/sequence, exact sample times, objective/reference, iteration bound, review-session age, and final review evidence. The job advances only when final confidence is at least 0.65 and no medium/high issue at confidence 0.65+ remains. Runtime acceptance remains separate.
