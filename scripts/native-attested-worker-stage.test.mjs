import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=file=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
const scheduler=get("src-tauri/src/native_scheduler.rs");
const progress=get("src-tauri/src/native_worker_progress.rs");
const plan=get("src-tauri/src/native_blender_owned_plan.rs");
const receipt=get("src-tauri/src/native_attested_worker_stage.rs");
const status=get("src-tauri/src/native_worker_status.rs");
test("only HMAC-verified worker pulses enter bounded exact-UUID durable Rust journal",()=>{
 assert.match(scheduler,/mod worker_attestation/);
 assert.match(progress,/pub\(crate\) fn verified_stage/);
 assert.match(plan,/progress\.observe\(\)\?/);
 assert.match(plan,/worker_attestation::record/);
 assert.ok(plan.indexOf("progress.observe()?")<plan.indexOf("worker_attestation::record("));
 assert.match(receipt,/job\.action_id!=action/);
 assert.match(receipt,/job\.phase!="running"/);
 assert.match(receipt,/resource_lanes::require_active_plan_claim/);
 assert.match(receipt,/StageOsLock::take\(file\)\?/);
 assert.match(receipt,/fn read_locked_at\(/);
 assert.match(receipt,/stage_os_lock_serializes_status_reads_and_cross_instance_writes/);
 assert.match(receipt,/stage_sequence_cannot_replay_changed_timestamp_or_backdated_evidence/);
 assert.match(receipt,/record_at\(&path\(app\)\?,AttestedStage/);
 assert.match(receipt,/durable_stage_advances_only_after_verified_worker_progress/);
 assert.match(receipt,/corrupted_or_replayed_different_plan_never_proves_stage/);
});
test("authenticated Python stages never grant permission, OS liveness or Blender success",()=>{
 assert.match(status,/fn attach_attested_worker_stage/);
 assert.match(status,/status\.progress_heartbeat_verified=false/);
 assert.match(status,/status\.safe_to_auto_retry=false/);
 assert.match(status,/signed_worker_stage_does_not_manufacture_app_success_or_liveness/);
 assert.doesNotMatch(receipt,/tauri::command|invoke_handler/);
 const ownership=get("src-tauri/src/native_resource_lanes.rs");
 assert.match(ownership,/fn require_plan_at/);
 assert.match(ownership,/attested_worker_stage_requires_exact_held_action_and_plan_provenance/);
 assert.match(ownership,/legacy_claim_without_plan_digest_cannot_authorize_new_stage_evidence/);
 const ui=get("src/main.ts");
 assert.match(ui,/archived Rust-recorded HMAC-checked Python stage/);
});

test("recovery-required worker display keeps last authenticated stage visible without claiming app success",()=>{
 const frontend=get("src/main.ts");
 const view=frontend.slice(frontend.indexOf("function nativeWorkerDisplay()"),frontend.indexOf("async function refreshNativeWorkerStatus()"));
 assert.match(view,/RECOVERY REQUIRED/);
 assert.match(view,/last signed Python worker stage/);
 assert.match(view,/NOT Blender success or OS liveness/);
 assert.match(view,/no automatic retry/);
 assert.match(frontend,/function resourceClaimsValid/);
});
