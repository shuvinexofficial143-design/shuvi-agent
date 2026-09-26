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
