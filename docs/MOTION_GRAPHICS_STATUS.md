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
- Shape layers now carry explicit bounded rectangle/ellipse geometry plus size, position, rectangle roundness, RGBA fill/stroke, and stroke width; invisible shape specs fail closed.
- The AE adapter maps those explicit shape specs only through the existing verified `add_shape` + `add_shape_primitive` host routes.
- Typed transform animation properties for position, scale, rotation, and opacity.
- Strictly increasing bounded keyframe times.
- Transparent-overlay plans require a transparent canvas.
- Read-only `motion_graphics_validate_plan` Shuvi tool.
- Provider-backed `motion_graphics_generate_plan` source path: the selected existing provider is asked once for raw renderer-neutral JSON, then Shuvi strictly parses and validates it before accepting the plan.
- Provider planning preserves fixed objective, renderer, duration, canvas, delivery, allowed asset IDs, and required review criteria; markdown/tool proposals, constraint drift, invented assets, and provider-generated shape layers fail closed.
- Read-only `motion_graphics_plan_after_effects` adapter planner.
- The AE adapter composes only existing typed host actions and never dispatches them automatically.
- It currently plans composition creation; text/group/image/video/rectangle/ellipse layer content when enough inspected identity exists; scene in/out timing; opacity, Z-rotation, single-axis Position/Scale component keyframes, aligned paired X+Y / ScaleX+ScaleY component timelines, and interpolation-type writes.
- A single X or Y track preserves the other After Effects Position components from exact host readback; a single ScaleX or ScaleY track does the same for Scale, with neutral scale factors converted to AE percent values.
- Aligned paired X+Y or ScaleX+ScaleY tracks are source-coalesced as two guarded component writes on the same exact host key timeline: the first requires no existing keys, the second requires the first write's exact absolute key times, and interpolation is staged only after both components are present.
- Paired tracks with mismatched keyframe times or easing remain fail-closed rather than synthesizing an unproven shared curve.
- Keyframe easing semantics are now explicit and local: ease-in affects the incoming/arrival side, ease-out the outgoing/departure side, ease-in-out both sides, while linear/hold apply to both.
- The AE adapter now stages the correct directional interpolation types for those sides; exact temporal speed/influence values are still intentionally unclaimed until bounded temporal-ease synthesis/readback is added.
- Component vector writes fail closed on separated dimensions, expression-enabled properties, stale existing-key timelines, dimension changes, or failed untouched-component readback.
- Dynamic comp/layer IDs may be resolved only from matching verified prior `after_effects_run` receipts.
- Every future AE mutation still requires a fresh `inspect_context`, exact saved-project path/revision, a unique request ID, the existing checkpoint boundary, and normal Shuvi approval.
- Dedicated `motion_graphics_review_preview` stages the exact bounded PNG bytes before approval and sends only those approved bytes to the selected vision provider.
- Single-frame review requires explicit plan review criteria, strict raw-JSON critique, known criteria/layer IDs, bounded issue text, and a pass/revise consistency check.
- Preview review can establish that one approved image was visually reviewed, but keeps renderer provenance, render-output verification, automatic correction, and production readiness false.
- Each review returns an exact `fnv1a64` plan snapshot.
- Provider-backed `motion_graphics_generate_correction` accepts only a `revise` review whose snapshot matches the exact supplied plan, caps request metadata at 3 iterations, preserves all fixed plan constraints and scene/layer identity/content, and permits only animation-track/keyframe/easing changes.
- Correction proposals reject unchanged plans, oversized context, markdown/tool-call output, topology/content drift, and shape synthesis. They never execute AE/Remotion mutations automatically.
- Validation/adapter summaries explicitly keep renderer execution, preview-render verification, and production readiness false.

## Intentional boundaries

- Claude does not directly render an MP4 in this foundation.
- No After Effects project/comp is created by the validator or AE adapter planner.
- The adapter no longer guesses X/Y or per-axis scale values: component tracks on combined Position/Scale properties are source-planned through exact host readback and untouched-component preservation.
- Paired X+Y or ScaleX+ScaleY tracks are accepted only when their keyframe times and easing exactly align; otherwise the planner blocks them. Separated dimensions also fail closed.
- Shape support is intentionally limited to rectangle/ellipse primitives already exposed by the verified AE bridge; arbitrary Bézier/path synthesis is not claimed.
- Shape geometry/style is immutable during provider correction proposals; correction may change only animation tracks.
- Image/video layers require an `asset_id -> item_id` binding grounded in fresh `inspect_project_items` evidence.
- `ease_in`, `ease_out`, and `ease_in_out` now map to the correct incoming/outgoing AE interpolation sides, but exact temporal speed/influence curve strength is not claimed until bounded temporal-ease synthesis/readback is added.
- Transparent-overlay delivery is not claimed until an alpha-capable output-module/render plan is implemented and verified.
- No Remotion project/code is generated or executed by the current planner.
- Provider plan generation has not yet been verified with a real API request in the packaged Shuvi runtime.
- A valid plan does not prove visual quality, renderer compatibility, output persistence, or final export correctness.
- Dedicated single-frame image review is now wired through the existing provider vision transport; multi-frame continuity review is not yet implemented.
- A single reviewed PNG does not prove that After Effects/Remotion produced it, that motion timing is correct, or that final export is valid.
- A bounded correction-proposal step exists, but a persistent multi-iteration correction session is not yet implemented. Review suggestions/revised plans are returned as data and are never auto-applied.
- Renderer execution must remain behind Shuvi's permission/action layer.

## Next source phase

1. Add bounded temporal-ease synthesis/readback for directional easing.
2. Add alpha-capable AE render/output-module planning and evidence without auto-rendering.
3. Build the Remotion adapter as a separate renderer implementation.
4. Add preview render evidence and bounded frame extraction so reviewed PNGs can be tied to a verified renderer output.
5. Add bounded multi-frame continuity review on top of the single-frame strict review contract.
6. Add a persistent correction session that carries the existing snapshot/iteration rules across review → proposal → approved renderer action → re-render → re-review, with no blind retries.
7. Add final output evidence and optional Premiere transparent-overlay insertion.
8. Extend shape support only if a future requirement needs arbitrary path/Bézier geometry; rectangle/ellipse primitives are already source-planned.
