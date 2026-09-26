# Premiere professional media and sequence preparation (AD)

Module AD adds native footage-interpretation, sequence-preset and work-area controls without conflating them with timeline speed, Motion Scale or sequence in/out.

## Media interpretation inspection

`premiere_inspect_media_interpretation` resolves one exact `ClipProjectItem` ID and returns the stable native values Premiere exposes:

- media path and offline state,
- proxy state/path,
- input LUT ID and embedded LUT ID,
- `FootageInterpretation` frame rate,
- pixel-aspect ratio,
- alpha/field/pulldown/VR interpretation values where readable,
- capability flags for the reviewed native actions.

Unreadable host values remain `null`; Shuvi does not guess them.

## Media preparation

`premiere_prepare_media_item` and `premiere_prepare_media_batch` use stable `ClipProjectItem` actions introduced in Premiere UXP 25.6:

- `createSetOverrideFrameRateAction`
- `createSetOverridePixelAspectRatioAction`
- `createSetScaleToFrameSizeAction`
- `createSetInputLUTIDAction`

The batch accepts up to 64 unique project items, takes one durable project checkpoint and supports cooperative cancellation between items. Each request may include the previously inspected media path; if the path changed or the item is offline, no interpretation edit is sent.

Frame-rate override is footage interpretation only. It is not timeline speed, time remapping or a speed ramp.

Frame rate, pixel aspect and input LUT are reinspected after mutation. The reviewed API exposes a native action for Scale to Frame Size but no dedicated readback getter, so a scale-to-frame-only operation remains `accepted_unverified` rather than being falsely promoted to verified.

Full opaque `FootageInterpretation` mutation is intentionally not exposed yet; only the explicit reviewed actions above are writable.

## Sequence creation from preset

`premiere_create_sequence_from_preset` validates an existing absolute preset file on the desktop and calls stable `Project.createSequenceWithPresetPath(name, presetPath)` (Premiere 26.3+). It verifies that the returned GUID is new in the project and reports the associated project-item ID when available. Existing sequences are never deleted/replaced and the workflow does not intentionally activate the new sequence.

## Work area

`premiere_get_work_area` and `premiere_set_work_area` use stable `WorkAreaUtils` (Premiere 26.5+):

- `getWorkAreaInPoint`
- `getWorkAreaOutPoint`
- `setWorkAreaInOutPoints`

Set requires an exact project/sequence expectation, validates `0 <= in < out <= sequence end`, checkpoints the project and verifies the resulting in/out values. Work area is kept distinct from Sequence in/out points.
