# Premiere mixed professional finishing (X2)

`premiere_finish_media_batch` is a high-risk bounded finishing workflow for explicit existing video/audio targets plus an optional saved V2 graphics batch. It reuses the current native recipe planners/executors instead of inventing a second editing stack.

## Capabilities

- Up to 32 explicit video targets and 32 explicit audio targets, with at most 48 existing clip targets total.
- Every video target has its own inspected motion/color recipe request.
- Every audio target has its own exact component/parameter selector and audio automation request.
- Optional saved MOGRT mapping + graphics batch is delegated to the V2 `premiere_graphics::run_batch` path.
- One durable project checkpoint is taken before the first mutation.
- Per-target applied/skipped/failed/uncertain receipts are returned.
- `premiere_finish_media_batch_cancel` stops between targets.
- Uncertain native delivery stops subsequent mutation; there is no blind retry.
- Optional before/after AI vision review uses at most eight deterministic midpoints from the affected video clips.

## Safety

The request must carry one exact fresh expectation for every existing video/audio target. Each native planner must return the same target expectation before its settings can execute. Graphics use the existing saved mapping revision and native reinspection. Link membership is never inferred.

The review result is evidence for comparison, not an objective artistic-quality score. Speed ramps, masks, multicam and inferred linked-media edits remain unsupported.

## Example

```json
{
  "tool":"premiere_finish_media_batch",
  "arguments":{
    "request":{
      "schema_version":1,
      "videos":[
        {
          "track":0,
          "clip_index":2,
          "request":{
            "preset":"natural_correction",
            "bindings":[
              {
                "role":"contrast",
                "component_match_name":"COPY_INSPECTED",
                "param_display_name":"COPY_INSPECTED",
                "unit":1,
                "min":0,
                "max":2
              }
            ]
          }
        }
      ],
      "audios":[],
      "graphics":null,
      "review":false
    },
    "expected":{
      "project_guid":"COPY_PROJECT_GUID",
      "sequence_guid":"COPY_SEQUENCE_GUID",
      "clips":[
        {"kind":"video","track":0,"clip_index":2,"signature":"COPY_SIGNATURE"}
      ]
    }
  }
}
```

Use exact native selectors observed from Premiere. Do not substitute friendly names or guessed parameter indexes.
