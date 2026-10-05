# Motion graphics / Claude status

- Current phase: renderer-neutral planning + fixed Remotion review/correction/delivery source pipeline.
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
- The AE adapter now stages the correct directional interpolation types for those sides and follows each eased key with the guarded host-dimension-aware `set_keyframe_temporal_ease_uniform` action.
- The current renderer mapping defines a deterministic default eased side as speed `0.0` with influence `33.333333`; the host reads its actual temporal-ease array length, preserves inactive sides, verifies exact key time, and readbacks the applied ease rather than letting the planner guess dimensionality.
- Component vector writes fail closed on separated dimensions, expression-enabled properties, stale existing-key timelines, dimension changes, or failed untouched-component readback.
- Dynamic comp/layer IDs may be resolved only from matching verified prior `after_effects_run` receipts.
- Every future AE mutation still requires a fresh `inspect_context`, exact saved-project path/revision, a unique request ID, the existing checkpoint boundary, and normal Shuvi approval.
- The AE bridge now exposes bounded read-only `inspect_output_module` evidence: exact queue/output-module identity, output file, bounded host `GetSettingsFormat.STRING` settings, raw Format/Channels/Depth display hints, and bounded template inventory.
- That inspection deliberately keeps `alpha_semantics_verified=false`; localized/display setting strings are evidence, not an automatic alpha-capability claim.
- Read-only `motion_graphics_plan_after_effects_output` now stages exactly two future steps: approved `add_render_queue_item` followed by `inspect_output_module` using the verified queue-index receipt. It never adds a render action.
- Transparent output keeps the explicit `alpha_output_runtime_attestation_required` blocker until runtime acceptance proves the exact host output settings are alpha-capable.
- Read-only `motion_graphics_plan_remotion` now maps a validated renderer-neutral plan into a bounded deterministic Remotion manifest with composition dimensions/fps/duration, exact floating frame positions, typed layers/tracks, and explicit absolute local asset bindings.
- The Remotion adapter does not generate arbitrary React/TypeScript. A fixed reviewed runtime now exists under `remotion-runtime/`; the planner itself still performs no filesystem write or render. Runtime execution must consume only the deterministic manifest and produce evidence before output is claimed.
- Dedicated `motion_graphics_review_preview` stages the exact bounded PNG bytes before approval and sends only those approved bytes to the selected vision provider.
- Single-frame review requires explicit plan review criteria, strict raw-JSON critique, known criteria/layer IDs, bounded issue text, and a pass/revise consistency check.
- Preview review can establish that one approved image was visually reviewed, but keeps renderer provenance, render-output verification, automatic correction, and production readiness false.
- Receipt-bound `motion_graphics_review_remotion_frames` verifies and stages 2–8 exact Remotion preview PNGs at approval time, sends those ordered images together in one vision request, and strict-parses cross-frame issues grounded to exact supplied sample times/layer IDs. It can assess sampled continuity/timing progression without claiming unsampled motion, renderer-process provenance, export correctness, or alpha correctness.
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
- `ease_in`, `ease_out`, and `ease_in_out` now have a deterministic source-planned AE mapping: directional interpolation plus a fixed zero-speed / 33.333333-influence eased side using host-dimension-aware readback. This is a Shuvi default curve contract, not a claim that it is the ideal creative curve for every animation.
- Transparent-overlay queue setup and output-module evidence are now source-planned, but delivery is still not claimed until runtime alpha attestation maps exact host output settings to an accepted alpha-capable configuration and final render evidence is verified.
- The deterministic Remotion manifest now includes its bounded review sample specification and can be consumed by the fixed `remotion-runtime/` source. Runtime execution is still permission-bound and has not been verified in packaged Shuvi on a real render yet.
- Read-only `motion_graphics_accept_remotion_evidence` now verifies an exact regenerated manifest against the saved manifest, binds the runtime receipt to the manifest SHA-256, and re-hashes every referenced preview/final output file. It deliberately reports `runtime_process_provenance_verified=false`: receipt/file consistency is not proof that Shuvi launched the renderer process.
- High-risk `motion_graphics_run_remotion` is now source-wired behind normal Shuvi approval. It materializes only compile-time embedded reviewed Remotion source, requires the exact pinned dependency versions, refuses output overwrite, registers the Node child as a managed process, enforces Shuvi's 4 GB hard RAM ceiling plus a bounded timeout, and accepts success only after the emitted receipt/final file re-pass SHA-256 evidence verification. No real render has been run in this source-only phase.
- The managed route verifies dependency package versions but does not claim byte-level integrity of third-party `node_modules`; `dependency_source_integrity_verified=false` remains explicit until a stronger packaging/supply-chain attestation exists.
- Provider plan generation has not yet been verified with a real API request in the packaged Shuvi runtime.
- A valid plan does not prove visual quality, renderer compatibility, output persistence, or final export correctness.
- Dedicated single-frame review remains available, and receipt-bound multi-frame review now compares 2–8 ordered Remotion sample frames in one vision request. Neither route proves that Shuvi itself launched the renderer process.
- A single reviewed PNG does not prove that After Effects/Remotion produced it, that motion timing is correct, or that final export is valid.
- The persisted correction-session loop is source-wired through exact review evidence → validated correction proposal → successful approved `motion_graphics_run_remotion` audit binding → re-render evidence → re-review. Renderer approval requires the same plan snapshot, deterministic manifest SHA-256, output path, and final output SHA-256; staged evidence is reverified at execution time and blind retries remain blocked. Revised plans are never auto-applied.
- Transparent Remotion delivery now has an approved `motion_graphics_probe_remotion_alpha` source path. It runs an exact `ffprobe` executable as a Shuvi-managed child with timeout/RAM guards, requires the already SHA-256-verified final MOV, and accepts alpha only when the selected video stream reports ProRes plus a `yuva*` pixel format. The resulting action-bound attestation is persisted and cannot be substituted across a different manifest/output hash.
- `motion_graphics_accept_final_remotion` combines the exact successful render-action audit binding, final output SHA-256, passing strict multi-frame visual review, and alpha attestation when transparent delivery requires it. The final acceptance remains `production_ready=false` because third-party dependency byte-level source integrity and packaged real-runtime acceptance are still separate concerns.
- `motion_graphics_plan_premiere_insertion` reads persisted final acceptance and emits only a normal `premiere_insert_media` proposal. It never edits Premiere automatically and still requires the existing Premiere permission/checkpoint path.
- Renderer execution must remain behind Shuvi's permission/action layer.

## Remaining verification / runtime work

1. Run the Motion Graphics source CI and Rust compile/tests on a real Windows environment; source code must not be called runtime-verified until those checks pass.
2. Perform one explicitly approved real Remotion render with Node and the exact pinned dependencies, then exercise multi-frame review, correction/re-render, alpha probe for a transparent MOV, final acceptance, and the optional Premiere insertion plan.
3. Byte-level third-party dependency/source integrity remains unverified, so final acceptance deliberately keeps `dependency_source_integrity_verified=false` and `production_ready=false`.
4. The After Effects-specific final delivery/alpha acceptance path still needs its own live host acceptance if AE is used as the final renderer; the completed final-delivery acceptance described above is the fixed Remotion route.
5. Arbitrary Bézier/path shape synthesis and configurable curve-strength controls remain optional future expansions, not blockers for the current rectangle/ellipse + deterministic easing scope.
