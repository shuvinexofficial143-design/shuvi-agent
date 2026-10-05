import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const motion=readFileSync(new URL("../src-tauri/src/motion_graphics.rs",import.meta.url),"utf8");
const provider=readFileSync(new URL("../src-tauri/src/motion_graphics_provider.rs",import.meta.url),"utf8");
const review=readFileSync(new URL("../src-tauri/src/motion_graphics_review.rs",import.meta.url),"utf8");
const correction=readFileSync(new URL("../src-tauri/src/motion_graphics_correction.rs",import.meta.url),"utf8");
const correctionSession=readFileSync(new URL("../src-tauri/src/motion_graphics_correction_session.rs",import.meta.url),"utf8");
const delivery=readFileSync(new URL("../src-tauri/src/motion_graphics_delivery.rs",import.meta.url),"utf8");
const status=readFileSync(new URL("../docs/MOTION_GRAPHICS_STATUS.md",import.meta.url),"utf8");

test("motion graphics keeps a renderer-neutral bounded schema",()=>{
  for(const token of ["Renderer","AfterEffects","Remotion","DeliveryKind","TransparentOverlay","LayerKind","Property","Easing"]){
    assert.match(motion,new RegExp(token));
  }
  assert.match(motion,/MAX_SCENES:usize=64/);
  assert.match(motion,/MAX_LAYERS_PER_SCENE:usize=128/);
  assert.match(motion,/MAX_KEYFRAMES_PER_TRACK:usize=96/);
  assert.match(motion,/keyframe times must be strictly increasing/);
  assert.match(motion,/Transparent overlay delivery requires transparent_background=true/);
});

test("motion graphics validation tool is read only",()=>{
  assert.match(rust,/motion_graphics_validate_plan/);
  assert.match(rust,/MotionGraphicsValidatePlan/);
  assert.match(rust,/plan\.validate\(\)\?/);
  assert.match(rust,/plan\.summary\(\)\?/);
  assert.match(motion,/renderer_execution_performed":false/);
  assert.match(motion,/preview_render_verified":false/);
  assert.match(motion,/visual_review_verified":false/);
  assert.match(motion,/production_ready":false/);
  assert.doesNotMatch(motion,/Command::new/);
});

test("Anthropic provider remains explicit and current-model configured",()=>{
  assert.match(rust,/id: "anthropic"/);
  assert.match(rust,/default_model: "claude-sonnet-5-5"/);
  assert.match(rust,/https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.match(rust,/anthropic-version/);
});

test("motion graphics docs do not overclaim renderer or visual review readiness",()=>{
  assert.match(status,/Source runtime verification: \*\*not verified\*\*/);
  assert.match(status,/Production ready: \*\*false\*\*/);
  assert.match(status,/No renderer is launched/);
  assert.match(status,/Dedicated single-frame review remains available/);
  assert.match(status,/receipt-bound multi-frame review now compares 2–8 ordered Remotion sample frames/);
  assert.match(status,/does not prove that After Effects\/Remotion produced it/);
  assert.match(status,/dependency_source_integrity_verified=false/);
  assert.match(status,/After Effects-specific final delivery\/alpha acceptance path still needs its own live host acceptance/);
});


test("After Effects adapter plan stays staged and guarded",()=>{
  assert.match(rust,/motion_graphics_plan_after_effects/);
  assert.match(rust,/MotionGraphicsPlanAfterEffects/);
  assert.match(motion,/AfterEffectsPlanRequest/);
  assert.match(motion,/automatic_execution":false/);
  assert.match(motion,/host_mutation_performed":false/);
  assert.match(motion,/requires_fresh_project_revision":true/);
  assert.match(motion,/requires_unique_request_id":true/);
  assert.match(motion,/\$verified_receipt/);
  assert.match(motion,/set_component_values_at_times/);
  assert.match(motion,/expected_existing_key_times/);
  assert.match(motion,/combined_vector_component_tracks_need_coalescing/);
  assert.match(motion,/ae_tracks_can_coalesce/);
  assert.match(motion,/coalesced_component_pair/);
  assert.match(motion,/Mismatched timelines remain fail-closed/);
  assert.match(motion,/preserves_unmodified_vector_components/);
  assert.match(motion,/missing_inspected_asset_item_id/);
  assert.match(motion,/ShapeSpec/);
  assert.match(motion,/LayerKind::Shape=>/);
  assert.match(motion,/add_shape_primitive/);
  assert.match(motion,/Shape layer.*requires fill_color and\/or stroke_color/);
  assert.match(motion,/transparent_render_output_not_planned/);
  assert.match(motion,/Easing::EaseIn=>\("bezier","linear",false\)/);
  assert.match(motion,/Easing::EaseOut=>\("linear","bezier",false\)/);
  assert.match(motion,/set_keyframe_temporal_ease_uniform/);
  assert.match(motion,/AE_DEFAULT_EASE_SPEED:f64=0\.0/);
  assert.match(motion,/AE_DEFAULT_EASE_INFLUENCE:f64=33\.333_333/);
  assert.match(motion,/ae_temporal_ease_sides/);
  assert.match(motion,/host_dimension_count_inferred":false/);
  assert.match(motion,/zero_speed_33_333333_influence/);
});


test("After Effects output planner stages host evidence without alpha or render overclaim",()=>{
  assert.match(rust,/motion_graphics_plan_after_effects_output/);
  assert.match(rust,/MotionGraphicsPlanAfterEffectsOutput/);
  assert.match(motion,/AfterEffectsOutputPlanRequest/);
  assert.match(motion,/add_render_queue_item/);
  assert.match(motion,/inspect_output_module/);
  assert.match(motion,/alpha_output_runtime_attestation_required/);
  assert.match(motion,/render_action_planned":false/);
  assert.match(motion,/alpha_capability_verified":false/);
  assert.match(motion,/output_module_settings_runtime_verified":false/);
  assert.match(motion,/never infers alpha from an output-module template name/);
});


test("Remotion adapter is deterministic manifest-only and grounded",()=>{
  assert.match(rust,/motion_graphics_plan_remotion/);
  assert.match(rust,/MotionGraphicsPlanRemotion/);
  assert.match(motion,/RemotionPlanRequest/);
  assert.match(motion,/Remotion asset path/);
  assert.match(motion,/frame_position/);
  assert.match(motion,/remotion_runtime_execution_required/);
  assert.match(motion,/remotion_alpha_output_runtime_not_verified/);
  assert.match(motion,/code_generation_performed":false/);
  assert.match(motion,/filesystem_write_performed":false/);
  assert.match(motion,/renderer_execution_performed":false/);
  assert.match(motion,/does not round keyframe times or invent extra keyframes/);
});


test("Remotion runtime evidence stays receipt-bound without process-provenance overclaim",()=>{
  const evidence=readFileSync(new URL("../src-tauri/src/motion_graphics_remotion.rs",import.meta.url),"utf8");
  assert.match(rust,/motion_graphics_accept_remotion_evidence/);
  assert.match(rust,/MotionGraphicsAcceptRemotionEvidence/);
  assert.match(evidence,/manifest_sha256/);
  assert.match(evidence,/receipt_binding_verified:true/);
  assert.match(evidence,/runtime_process_provenance_verified:false/);
  assert.match(evidence,/preview frame SHA-256 mismatch/);
  assert.match(evidence,/final output SHA-256 mismatch/);
  assert.match(evidence,/alpha_channel_probe_verified/);
  assert.doesNotMatch(evidence,/Command::new/);
});

test("provider-generated motion plans are strict and fail closed",()=>{
  assert.match(rust,/motion_graphics_generate_plan/);
  assert.match(rust,/MotionGraphicsGeneratePlan/);
  assert.match(rust,/motion_graphics_provider::system_prompt/);
  assert.match(rust,/send_chat\(/);
  assert.match(rust,/response\.tool_proposal\.is_some\(\)/);
  assert.match(rust,/request\.parse_generated\(&response\.content\)\?/);
  assert.match(rust,/strict_json_validated":true/);
  assert.match(rust,/fixed_constraints_preserved":true/);
  assert.match(provider,/raw JSON only/);
  assert.match(provider,/Generated motion-graphics plan changed the fixed objective/);
  assert.match(provider,/invented unavailable asset_id/);
  assert.match(provider,/Shape layers require shape=/);
  assert.match(provider,/ellipse roundness must be 0/);
  assert.match(provider,/ease_in affects only the incoming\/arrival side/);
  assert.match(provider,/must return raw JSON without markdown fences/);
  assert.match(provider,/MAX_PROVIDER_PLAN_BYTES:usize=256\*1024/);
  assert.doesNotMatch(provider,/Command::new/);
});


test("motion preview review sends only approved bytes and never auto-fixes",()=>{
  assert.match(rust,/motion_graphics_review_preview/);
  assert.match(rust,/MotionGraphicsReviewPreview/);
  assert.match(rust,/preview_bytes: Vec<u8>/);
  assert.match(rust,/read_file_bytes_bounded\(path,8\*1024\*1024,"motion preview PNG"\)/);
  assert.match(rust,/analyze_png_bytes_with_provider\(&provider,&prompt,&preview_bytes\)\.await\?/);
  assert.match(rust,/preview_bytes_bound_at_approval":true/);
  assert.match(rust,/renderer_provenance_verified":false/);
  assert.match(rust,/automatic_correction_performed":false/);
  assert.match(review,/Judge only what is visibly supported by this frame/);
  assert.match(review,/must return raw JSON without markdown fences/);
  assert.match(review,/used a criterion outside the plan allowlist/);
  assert.match(review,/invented unknown layer id/);
  assert.match(review,/A passing motion visual review must not contain issues/);
  assert.doesNotMatch(review,/Command::new/);
});


test("managed Remotion render action uses embedded fixed source and guarded execution",()=>{
  const runtime=readFileSync(new URL("../src-tauri/src/motion_graphics_remotion_runtime.rs",import.meta.url),"utf8");
  assert.match(rust,/motion_graphics_run_remotion/);
  assert.match(rust,/MotionGraphicsRunRemotion/);
  assert.match(rust,/RiskLevel::High/);
  assert.match(rust,/register_managed_process\(state,child_pid\)/);
  assert.match(rust,/status\.over_hard_limit/);
  assert.match(rust,/prepared\.timeout_ms/);
  assert.match(rust,/shuvi_managed_runtime_launch_verified":true/);
  assert.match(runtime,/include_bytes!\("\.\.\/\.\.\/remotion-runtime\/render\.mjs"\)/);
  assert.match(runtime,/REQUIRED_PACKAGES/);
  assert.match(runtime,/output_file already exists; overwrite is intentionally refused/);
  assert.match(runtime,/dependency_versions/);
  assert.doesNotMatch(runtime,/Command::new/);
  assert.doesNotMatch(runtime,/eval\s*\(|new Function|Function\s*\(/);
});

test("receipt-bound multi-frame Remotion review is bounded and never auto-fixes",()=>{
  const evidence=readFileSync(new URL("../src-tauri/src/motion_graphics_remotion.rs",import.meta.url),"utf8");
  assert.match(rust,/motion_graphics_review_remotion_frames/);
  assert.match(rust,/MotionGraphicsReviewRemotionFrames/);
  assert.match(rust,/verify_and_stage_review\(&request\)/);
  assert.match(rust,/analyze_png_frames_with_provider\(&provider,&prompt,&frames\)\.await\?/);
  assert.match(rust,/preview_bytes_bound_at_approval":true/);
  assert.match(rust,/multi_frame_review_completed":true/);
  assert.match(rust,/renderer_provenance_verified":accepted\.runtime_process_provenance_verified/);
  assert.match(review,/multi_frame_prompt/);
  assert.match(review,/frame_times_seconds\.len\(\)<2\|\|frame_times_seconds\.len\(\)>MAX_MULTI_REVIEW_FRAMES/);
  assert.match(review,/unsupplied frame time/);
  assert.match(review,/Do not claim audio, renderer process provenance, export correctness, alpha correctness, or unsampled motion/);
  assert.match(evidence,/MAX_MULTI_REVIEW_FRAMES:usize=8/);
  assert.match(evidence,/changed after evidence verification/);
  assert.doesNotMatch(review,/Command::new/);
  assert.doesNotMatch(evidence,/Command::new/);
});

test("bounded correction session blocks stale snapshots and blind retries",()=>{
  assert.match(rust,/mod motion_graphics_correction_session;/);
  assert.match(correctionSession,/MAX_CORRECTIONS:u8=3/);
  assert.match(correctionSession,/Motion correction review snapshot is stale or belongs to another plan/);
  assert.match(correctionSession,/blind retry is blocked/);
  assert.match(correctionSession,/AwaitingRendererApproval/);
  assert.match(correctionSession,/Re-render evidence cannot be recorded before renderer approval/);
  assert.match(correctionSession,/SessionStatus::Stagnated/);
  assert.doesNotMatch(correctionSession,/Command::new/);
});

test("motion correction session start and status persist bounded state without auto execution",()=>{
  assert.match(rust,/motion_graphics_correction_session_start/);
  assert.match(rust,/motion_graphics_correction_session_status/);
  assert.match(rust,/MotionGraphicsCorrectionSessionStart/);
  assert.match(rust,/MotionGraphicsCorrectionSessionStatus/);
  assert.match(rust,/motion_graphics_correction_session::save\(&path,&session\)\?/);
  assert.match(rust,/motion_graphics_correction_session::load\(&path\)\?/);
  assert.match(rust,/review_recording_wired":true/);
  assert.match(rust,/automatic_execution":false/);
  assert.match(correctionSession,/pub fn save\(path:&Path/);
  assert.match(correctionSession,/pub fn load\(path:&Path/);
  assert.match(correctionSession,/MAX_SESSION_BYTES:usize=64\*1024/);
  assert.match(correctionSession,/SessionStatus::Failed/);
  assert.doesNotMatch(correctionSession,/Command::new/);
});

test("motion correction session can be cancelled without renderer execution",()=>{
  assert.match(rust,/motion_graphics_correction_session_cancel/);
  assert.match(rust,/MotionGraphicsCorrectionSessionCancel/);
  assert.match(rust,/session\.cancel\(\)\?/);
  assert.match(correctionSession,/SessionStatus::Cancelled/);
  assert.doesNotMatch(correctionSession,/Command::new/);
});

test("motion correction session records exact reviews and proposals before renderer approval",()=>{
  assert.match(rust,/motion_graphics_correction_session_record_review/);
  assert.match(rust,/motion_graphics_correction_session_record_correction/);
  assert.match(rust,/MotionGraphicsCorrectionSessionRecordReview/);
  assert.match(rust,/MotionGraphicsCorrectionSessionRecordCorrection/);
  assert.match(rust,/request\.validate\(\)\?/);
  assert.match(rust,/session\.record_review\(/);
  assert.match(rust,/session\.record_correction\(/);
  assert.match(rust,/correction_generation_performed":false/);
  assert.match(rust,/renderer_approval_recorded":false/);
  assert.match(rust,/renderer_execution_performed":false/);
  assert.match(correctionSession,/ReviewRecordRequest/);
  assert.match(correctionSession,/validate_multi_frame_review/);
  assert.match(correctionSession,/validate_review/);
  assert.match(correctionSession,/CorrectionRecordRequest/);
  assert.match(correctionSession,/validate_revision_constraints/);
  assert.match(correction,/pub fn validate_revision_constraints/);
  assert.doesNotMatch(correctionSession,/Command::new/);
});

test("correction session binds approved Remotion render and rerender evidence",()=>{
  assert.match(rust,/motion_graphics_correction_session_record_renderer_approval/);
  assert.match(rust,/motion_graphics_correction_session_record_rerender/);
  assert.match(rust,/verify_remotion_action_receipt_binding/);
  assert.match(rust,/plan_snapshot=/);
  assert.match(rust,/manifest_sha256=/);
  assert.match(rust,/renderer_action_audit_binding_verified":true/);
  assert.match(rust,/rerender_evidence_verified":true/);
  assert.match(correctionSession,/rerender_output_sha256/);
  assert.match(correctionSession,/Re-render evidence action_id does not match the approved renderer action/);
  assert.doesNotMatch(correctionSession,/Command::new/);
});

test("persisted delivery attestations require matching audit receipts",()=>{
  assert.match(rust,/verify_motion_action_receipt_tokens/);
  assert.match(rust,/motion_graphics_probe_remotion_alpha/);
  assert.match(rust,/motion_graphics_accept_final_remotion/);
  assert.match(rust,/output_path_sha256=/);
  assert.match(rust,/motion_path_sha256/);
  assert.match(rust,/Motion action audit receipt does not bind the exact persisted attestation evidence/);
});

test("final Remotion delivery requires real alpha evidence and keeps Premiere insertion approval-gated",()=>{
  assert.match(rust,/motion_graphics_probe_remotion_alpha/);
  assert.match(rust,/MotionGraphicsProbeRemotionAlpha/);
  assert.match(rust,/register_managed_process\(state,pid\)/);
  assert.match(rust,/Alpha probe exceeded the 20 second safety timeout/);
  assert.match(rust,/Alpha probe exceeded Shuvi's 4 GB hard RAM ceiling/);
  assert.match(rust,/motion_graphics_accept_final_remotion/);
  assert.match(rust,/motion_graphics_plan_premiere_insertion/);
  assert.match(delivery,/AlphaAttestation/);
  assert.match(delivery,/codec_name!="prores"/);
  assert.match(delivery,/pixel_format\.to_ascii_lowercase\(\)\.starts_with\("yuva"\)/);
  assert.match(delivery,/Final Remotion acceptance requires a passing multi-frame visual review/);
  assert.match(delivery,/runtime_process_provenance_verified/);
  assert.match(delivery,/dependency_source_integrity_verified/);
  assert.match(delivery,/production_ready:false/);
  assert.match(delivery,/"tool":"premiere_insert_media"/);
  assert.match(delivery,/"automatic_execution":false/);
  assert.match(delivery,/"requires_normal_premiere_approval":true/);
});

test("motion correction stays snapshot-bound and proposal-only",()=>{
  assert.match(rust,/motion_graphics_generate_correction/);
  assert.match(rust,/MotionGraphicsGenerateCorrection/);
  assert.match(rust,/motion_graphics_correction::system_prompt/);
  assert.match(rust,/request\.parse_revision\(&response\.content\)\?/);
  assert.match(rust,/snapshot_match_verified":true/);
  assert.match(rust,/immutable_topology_preserved":true/);
  assert.match(rust,/automatic_correction_performed":false/);
  assert.match(motion,/pub fn fingerprint\(&self\)/);
  assert.match(motion,/fnv1a64:/);
  assert.match(correction,/plan_snapshot does not match the exact supplied plan/);
  assert.match(correction,/MAX_CORRECTION_ITERATIONS:u8=3/);
  assert.match(correction,/MAX_CORRECTION_CONTEXT_BYTES:usize=384\*1024/);
  assert.match(correction,/You may change only layer animation tracks/);
  assert.match(correction,/ease_in affects only arrival/);
  assert.match(correction,/changed immutable layer identity\/content/);
  assert.match(correction,/old\.shape!=new\.shape/);
  assert.match(correction,/returned the unchanged plan/);
  assert.match(review,/MAX_REVIEW_ACTIVE_LAYERS:usize=512/);
  assert.doesNotMatch(correction,/Command::new/);
});
