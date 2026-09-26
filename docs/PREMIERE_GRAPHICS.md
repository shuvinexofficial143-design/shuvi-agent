# Professional batch graphics (V2)

V2 inserts a supplied MOGRT, identifies the resulting native video clip, validates every mapped primitive property, applies the existing video recipe and reads the result back. It supports lower thirds, main/chapter titles, CTA, price and location cards through the same executor. It does not infer field meaning from names or claim to recognize arbitrary template identity.

## Save an inspected mapping

First inspect a known reference graphic with `premiere_inspect_mogrt_properties`. Copy its exact `expected`, component selector, parameter name and primitive type. The mapping's source path/library and semantic roles are explicitly supplied by the caller. Saving reinspects the reference clip and refuses incomplete, ambiguous, animated, complex or incompatible properties. It does not prove that the caller's path corresponds to the reference clip; each insertion is checked again.

```json
{
  "tool": "premiere_save_graphics_template_mapping",
  "arguments": {
    "mapping": {
      "schema_version": 1,
      "name": "doctor_lower_third",
      "template": {"source": "path", "path": "C:/templates/doctor.mogrt"},
      "fields": [
        {"role": "name", "component_match_name": "COPY EXACT INSPECTED SELECTOR", "param_display_name": "COPY EXACT NAME FIELD", "primitive_type": "string"},
        {"role": "designation", "component_match_name": "COPY EXACT INSPECTED SELECTOR", "param_display_name": "COPY EXACT DESIGNATION FIELD", "primitive_type": "string"}
      ]
    },
    "track": 1,
    "clip_index": 0,
    "expected_revision": null,
    "expected": {"project_guid": "COPY PROJECT GUID", "sequence_guid": "COPY SEQUENCE GUID", "clips": [{"kind": "video", "track": 1, "clip_index": 0, "signature": "COPY INSPECTED SIGNATURE"}]}
  }
}
```

The placeholders above must be replaced with native observations. A library source instead uses `{"source":"library","library_name":"Exact library","element_name":"Exact element"}`. Primitive types are `string`, `number`, and `boolean`; values are never coerced. Role labels such as `name`, `designation`, `price`, or a custom label have no implied native semantics.

Use `premiere_list_graphics_template_mappings` to retrieve mappings and revisions. A duplicate name fails unless `expected_revision` equals the current revision; an update increments it. Delete with `premiere_delete_graphics_template_mapping` using `name` and the exact `revision`. Deletion removes only the local mapping. A batch must name the revision it intends to use, so an intervening update fails before editing.

The store is `premiere/graphics-mappings.json` in Shuvi app data, limited to 64 mappings and 96 KiB. Writes flush a temporary file, preserve the prior file during replacement and serialize access. An interrupted `.json.tmp` or `.json.bak` stops relevant operations for explicit recovery; it is never silently overwritten. The file contains data only, with no executable fields or template media.

## Insert a batch

```json
{
  "tool": "premiere_batch_lower_thirds",
  "arguments": {
    "batch": {
      "mapping": "doctor_lower_third",
      "revision": 1,
      "video_track": 1,
      "audio_track": 1,
      "items": [
        {"seconds": 5, "fields": {"name": "Dr. A", "designation": "MBBS"}, "duration_seconds": 2},
        {"seconds": 15, "fields": {"name": "Dr. B", "designation": "MD"}}
      ]
    },
    "expected": {"project_guid": "COPY PROJECT GUID", "sequence_guid": "COPY SEQUENCE GUID", "clips": []}
  }
}
```

`premiere_batch_graphics` accepts the same input for all card roles. Tracks are zero-based and must already exist. The desktop requires a complete timeline preflight, a valid local template when using a file, exact project/sequence expectation, high-risk permission and one durable `.prproj` checkpoint before the first insertion. Every mapped role must have an explicit value in every item. Limits: 32 items, 16 fields per mapping, 2048 UTF-16 units per string, 96 KiB batch input and 512 clips per inspected destination track. An output budget can stop a batch before all 32 items when signatures are unusually large; `output_limit_reached` and `processed` make that explicit.

Each item calls the fixed `insert_mapped_graphic` bridge route. It uses the documented file/library insertion API, compares before/after destination tracks with the native returned items, requires one unambiguous new video clip at the requested native time and checks that existing clips did not change. It then inspects all mapped properties, delegates to `apply_video_recipe`, optionally delegates to `trim_clip`, and checks identity, timing and primitive value readback. No agent-supplied action/code is dispatched.

Choose clear destination tracks/times. Occupied placement points and known requested-duration overlaps fail before insertion. Native template duration is only known after insertion; an unexpected overlap or change to existing clips stops the batch with recovery information. A mismatch in mapped properties leaves the inserted default graphic in place, reports `failed` with `inserted=true`, and may continue to an independent later item. There is no silent delete or automatic rollback.

## Duration and recovery

`duration_seconds` supports shortening an inserted video-only graphic with the documented native end action. Extending a template, trimming accompanying audio or unavailable setters are explicitly unsupported. Such an item reports its original `native_duration_seconds` and fails before parameter population. With no requested duration, the native duration is preserved. Accepted writes and trims are read back; failed/mismatched readback is uncertain and stops the batch.

Each processed item reports status, insertion/population/trim flags, exact inspected video expectation when available, observed audio additions, timing and any failure phase. The aggregate reports requested/processed/applied counts, checkpoint path, cancellation, completeness and uncertainty. `premiere_cancel_graphics_batch` stops between graphics (and after checkpoint creation); it cannot abort or undo the currently dispatched item. Any transport error after dispatch stops conservatively as uncertain, without relying on error wording and without retry. Inspect Premiere and the checkpoint before recovery. Do not blindly replay the original batch: earlier items may already exist.

Host references reviewed on 2026-09-26: [SequenceEditor insertion receipts](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor) and [VideoClipTrackItem timing/end action](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem). Native APIs and primitive readback do not establish visual quality. Node mocks are not live Premiere acceptance; real template/undo/visual checks remain required.

## Validation evidence

- 29 new Node tests exercise actual UXP routes with mocked native objects, including 32 placements, primitive types, template mismatches, partial failure, stale targets, insertion uncertainty, readback and conditional duration.
- Nine Rust unit tests cover persistence, revision conflicts, limits, exact inspection, actual batch orchestration, checkpoint failure, cancellation and uncertainty. Local Rust/Cargo was unavailable, so these tests and full Rust compilation are not attested.
- The full Node suite passed 166 tests; repository validation and frontend build passed. The previous main CI run (`36040993736`) had failed jobs with zero steps, not observed source test failures.
