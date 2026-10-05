# Motion graphics / Claude status

- Current phase: renderer-neutral planning foundation.
- Source runtime verification: **not verified**.
- Production ready: **false**.
- No renderer is launched by the current motion-graphics plan validator.

## Existing provider foundation

- Shuvi already has a native Anthropic provider using the Messages API.
- Anthropic API keys remain stored through Shuvi's existing credential-store path.
- The default Anthropic model is `claude-sonnet-5-5`.
- The normal provider chat path is still text-oriented; dedicated strict motion-plan generation reuses that provider path, and dedicated single-frame preview review now reuses Shuvi's existing provider vision transport.

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
- Provider-backed `motion_graphics_generate_plan` source path: the selected existing provider is asked once for raw renderer-neutral JSON, then Shuvi strictly parses and validates it before accepting the plan.
- Provider planning preserves fixed objective, renderer, duration, canvas, delivery, allowed asset IDs, and required review criteria; markdown/tool proposals, constraint drift, invented assets, and provider-generated shape layers fail closed.
- Read-only `motion_graphics_plan_after_effects` adapter planner.
- The AE adapter composes only existing typed host actions and never dispatches them automatically.
- It currently plans composition creation; text/group/image/video layer creation when enough inspected identity exists; scene in/out timing; opacity and Z-rotation keyframes; and interpolation-type writes.
- Dynamic comp/layer IDs may be resolved only from matching verified prior `after_effects_run` receipts.
- Every future AE mutation still requires a fresh `inspect_context`, exact saved-project path/revision, a unique request ID, the existing checkpoint boundary, and normal Shuvi approval.
- Dedicated `motion_graphics_review_preview` stages the exact bounded PNG bytes before approval and sends only those approved bytes to the selected vision provider.
- Single-frame review requires explicit plan review criteria, strict raw-JSON critique, known criteria/layer IDs, bounded issue text, and a pass/revise consistency check.
- Preview review can establish that one approved image was visually reviewed, but keeps renderer provenance, render-output verification, automatic correction, and production readiness false.
- Validation/adapter summaries explicitly keep renderer execution, preview-render verification, and production readiness false.

## Intentional boundaries

- Claude does not directly render an MP4 in this foundation.
- No After Effects project/comp is created by the validator or AE adapter planner.
- The adapter refuses to guess X/Y or per-axis scale values because AE transform properties may be combined or separated; exact vector synthesis needs fresh property readback first.
- Shape layers are not fabricated as invisible placeholders: the current neutral schema still needs explicit geometry/fill/stroke/path data before shape content can be mapped.
- Image/video layers require an `asset_id -> item_id` binding grounded in fresh `inspect_project_items` evidence.
- `ease_in`, `ease_out`, and `ease_in_out` currently map only to AE bezier interpolation type; exact directional temporal-ease semantics are not claimed until bounded temporal-ease synthesis/readback is added.
- Transparent-overlay delivery is not claimed until an alpha-capable output-module/render plan is implemented and verified.
- No Remotion project/code is generated or executed by the current planner.
- Provider plan generation has not yet been verified with a real API request in the packaged Shuvi runtime.
- A valid plan does not prove visual quality, renderer compatibility, output persistence, or final export correctness.
- Dedicated single-frame image review is now wired through the existing provider vision transport; multi-frame continuity review is not yet implemented.
- A single reviewed PNG does not prove that After Effects/Remotion produced it, that motion timing is correct, or that final export is valid.
- No correction loop is claimed yet; review suggestions are returned as data and are never auto-applied.
- Renderer execution must remain behind Shuvi's permission/action layer.

## Next source phase

1. Extend the neutral schema/AE adapter for explicit shape geometry/style and exact vector transform synthesis after fresh AE property readback.
3. Add bounded temporal-ease synthesis/readback for directional easing.
4. Add alpha-capable AE render/output-module planning and evidence without auto-rendering.
5. Build the Remotion adapter as a separate renderer implementation.
6. Add preview render evidence and bounded frame extraction so reviewed PNGs can be tied to a verified renderer output.
7. Add bounded multi-frame continuity review on top of the single-frame strict review contract.
8. Add a correction loop with iteration caps, exact plan/revision identity, explicit approval, and no blind retries.
9. Add final output evidence and optional Premiere transparent-overlay insertion.
