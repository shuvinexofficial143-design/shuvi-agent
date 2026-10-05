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
- Validation summary explicitly keeps renderer execution, preview verification, visual review verification, and production readiness false.

## Intentional boundaries

- Claude does not directly render an MP4 in this foundation.
- No After Effects project/comp is created by the validator.
- No Remotion project/code is generated or executed by the validator.
- A valid plan does not prove visual quality, renderer compatibility, output persistence, or final export correctness.
- Image/frame review is not yet wired into the Anthropic request path.
- No correction loop is claimed until preview frames can be sent back to the selected vision-capable provider and the resulting fixes can be independently applied and re-rendered.
- Renderer execution must remain behind Shuvi's permission/action layer.

## Next source phase

1. Add a dedicated motion-graphics planner that asks the selected provider for the renderer-neutral schema and validates it before accepting the plan.
2. Add renderer capability selection without launching either renderer.
3. Build the After Effects adapter from the validated neutral plan using the existing AE transport and persistence/acceptance boundaries.
4. Build the Remotion adapter as a separate renderer implementation.
5. Add preview render evidence and bounded frame extraction.
6. Extend the Anthropic review path to send preview images as image content blocks and return structured visual critique.
7. Add a correction loop with iteration caps, exact plan/revision identity, and no blind retries.
8. Add final output evidence and optional Premiere transparent-overlay insertion.
