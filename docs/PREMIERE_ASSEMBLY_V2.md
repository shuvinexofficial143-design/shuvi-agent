# Premiere advanced timeline assembly (Y2)

Assembly schema version 2 extends the existing deterministic shot-list workflow with source ranges, explicit A-roll/B-roll/overlay roles, supplied beat references, installed transitions, music placements and V2 mapped graphics. Version 1 remains accepted for the original simple shot/chapter workflow.

## Source ranges

A shot may provide both `source_in` and `source_out`. Shuvi checkpoints the project, creates a hard-bounded native subclip, then requires exact before/after project-item correlation from the paired panel. The new subclip ID is used for insertion only when exactly one new native clip item can be identified. Ambiguous correlation stops the assembly; it is never guessed by name alone.

## Shot roles and beats

`role` may be `a_roll`, `b_roll` or `overlay`. The role is descriptive; placement still uses the exact existing `video_track` / `audio_track`. Shuvi does not claim a general vertical-move capability.

A shot can reference a caller-supplied `beat_index`. The resolved sequence time comes from the explicit bounded `beats` array. No beat detection is performed.

## Transitions

Version 2 transitions reference a `shot_index`, installed transition `match_name`, duration and start/end position. Installed transition names are preflighted. After insertion Shuvi reinspects the timeline and requires exactly one video clip at the requested shot track/time before using the existing `add_video_transition` route. If insertion/ripple changed the boundary so correlation is no longer unique, the transition fails closed.

## Music, graphics, markers and review

- Up to 8 explicit music project items can be inserted on caller-supplied tracks/times.
- Optional graphics delegate to the existing V2 saved mapping/batch workflow.
- Existing Chapter markers remain supported.
- Requested review returns at most eight deterministic shot timestamps and the existing `premiere_review_frames` tool to execute the visual review. The assembly executor itself does not invent a vision verdict.

All mutation shares one durable project checkpoint. Cancellation is cooperative between operations. Any uncertain mutating bridge delivery stops later work; there is no blind retry or automatic rollback claim.

## Example schema v2

```json
{
  "schema_version":2,
  "beats":[0,1.2,2.4,3.6],
  "shots":[
    {
      "item_id":"A_ROLL_ITEM",
      "timeline_seconds":0,
      "video_track":0,
      "audio_track":0,
      "mode":"overwrite",
      "source_in":2,
      "source_out":7,
      "role":"a_roll"
    },
    {
      "item_id":"B_ROLL_ITEM",
      "timeline_seconds":0,
      "beat_index":2,
      "video_track":1,
      "audio_track":1,
      "mode":"overwrite",
      "role":"b_roll"
    }
  ],
  "transitions":[
    {
      "shot_index":1,
      "match_name":"COPY_INSTALLED_MATCH_NAME",
      "duration_seconds":0.4,
      "position":"start",
      "force_single_sided":false
    }
  ],
  "music":[
    {
      "item_id":"MUSIC_ITEM",
      "timeline_seconds":0,
      "video_track":0,
      "audio_track":2,
      "mode":"insert"
    }
  ],
  "chapters":[{"name":"Intro","seconds":0}],
  "graphics":null,
  "review":true
}
```

Use `premiere_plan_assembly` first, then `premiere_apply_assembly` with the exact returned project/sequence expectation.
