# Motion graphics / Claude status

- Current phase: renderer-neutral planning foundation.
- Source runtime verification: **not verified**.
- Production ready: **false**.
- No renderer is launched by the current motion-graphics plan validator.

## Existing provider foundation

- Shuvi already has a native Anthropic provider using the Messages API.
- Anthropic API keys remain stored through Shuvi's existing credential-store path.
- The default Anthropic model is `claude-sonnet-5-5`.
- The normal provider chat path is still text-oriented; frame/image review is not yet wired into the dedicated motion-graphics workflow.

## Implemented motion-graphics source scope

- Renderer-neutral schema in `src-tauri/src/motion_graphics.rs`.
- Renderer preference values: `auto`, `after_effects`, and `remotion`.
- Delivery modes: standalone video or transparent overlay.
- Bounded canvas, duration, scene, layer, animation-track, keyframe, review-sample, and review-criteria contracts.
- Layer kinds for text, shape, image, video, and group.
- Typed transform animation properties for position, scale, rotation, and opacity.
- Strictly increasing bounded keyframe times.
- Transparent-overlay plans require a transparent canvas.
- Read-only `motion_graphics_validate_plan` Shuvi tool.
- Read-only `motion_graphics_plan_after_effects` adapter planner.
- The AE adapter composes only existing typed host actions and never dispatches them automatically.
- It currently plans composition creation; text/group/image/video layer creation when enough inspected identity exists; scene in/out timing; opacity and Z-rotation keyframes; and interpolation-type writes.
- Dynamic comp/layer IDs may be resolved only from matching verified prior `after_effects_run` receipts.
- Every future AE mutation still requires a fresh `inspect_context`, exact saved-project path/revision, a unique request ID, the existing checkpoint boundary, and normal Shuvi approval.
- Validation/adapter summaries explicitly keep renderer execution, preview verification, visual review verification, and production readiness false.

## Intentional boundaries

- Claude does not directly render an MP4 in this foundation.
- No After Effects project/comp is created by the validator or AE adapter planner.
- The adapter refuses to guess X/Y or per-axis scale values because AE transform properties may be combined or separated; exact vector synthesis needs fresh property readback first.
- Shape layers are not fabricated as invisible placeholders: the current neutral schema still needs explicit geometry/fill/stroke/path data before shape content can be mapped.
- Image/video layers require an `asset_id -> item_id` binding grounded in fresh `inspect_project_items` evidence.
- `ease_in`, `ease_out`, and `ease_in_out` currently map only to AE bezier interpolation type; exact directional temporal-ease semantics are not claimed until bounded temporal-ease synthesis/readback is added.
- Transparent-overlay delivery is not claimed until an alpha-capable output-module/render plan is implemented and verified.
- No Remotion project/code is generated or executed by the current planner.
- A valid plan does not prove visual quality, renderer compatibility, output persistence, or final export correctness.
- Image/frame review is not yet wired into the Anthropic request path.
- No correction loop is claimed until preview frames can be sent back to the selected vision-capable provider and the resulting fixes can be independently applied and re-rendered.
- Renderer execution must remain behind Shuvi's permission/action layer.

## Next source phase

1. Add a dedicated provider planner that asks the selected model for the renderer-neutral schema and validates it before accepting the plan.
2. Extend the neutral schema/AE adapter for explicit shape geometry/style and exact vector transform synthesis after fresh AE property readback.
3. Add bounded temporal-ease synthesis/readback for directional easing.
4. Add alpha-capable AE render/output-module planning and evidence without auto-rendering.
5. Build the Remotion adapter as a separate renderer implementation.
6. Add preview render evidence and bounded frame extraction.
7. Extend the Anthropic review path to send preview images as image content blocks and return structured visual critique.
8. Add a correction loop with iteration caps, exact plan/revision identity, and no blind retries.
9. Add final output evidence and optional Premiere transparent-overlay insertion.
