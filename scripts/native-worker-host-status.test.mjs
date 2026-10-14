import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const status=readFileSync(new URL("../src-tauri/src/native_worker_status.rs",import.meta.url),"utf8");
const jobs=readFileSync(new URL("../src-tauri/src/native_worker_job.rs",import.meta.url),"utf8");
const lease=readFileSync(new URL("../src-tauri/src/execution_lease.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("read-only worker status is wired to the actual Tauri action state and durable recovery journal",()=>{
 assert.match(lib,/mod native_worker_status;/);
 assert.match(lib,/fn native_worker_status\(/);
 assert.match(lib,/native_worker_status::snapshot\(/);
 assert.match(lib,/native_recovery::load\(&app\)/);
 assert.match(lib,/\s+native_worker_status,\s/);
 assert.match(status,/lease_owned_by_this_process/);
 assert.match(status,/cross_process_lease_state:"unknown_not_probed"\.into\(\)/);
 assert.match(status,/progress_heartbeat_verified:false/);
 assert.match(status,/safe_to_auto_retry:false/);
 assert.match(lib,/native_worker_job::attach_durable_job|native_worker_status::attach_durable_job/);
 assert.match(lib,/native_worker_job::read\(&app\)/);
 assert.doesNotMatch(status,/execute_tool_with_action_id|claim_single_execution|send_chat/);
});
test("native desktop mutation sites reuse the original process-wide guard and never bypass stale identity checks",()=>{
 assert.match(lease,/claim_windows_desktop_lease\(/);
 assert.match(lib,/fn claim_monitored_native_execution<'a>\(/);
 assert.match(lib,/native_worker_status::require_clear_for_new_dispatch/);
 assert.equal((lib.match(/let _native_slot\s*=\s*claim_monitored_native_execution\(state\.inner\(\),&app\)\?;/g)??[]).length,12);
 assert.match(lib,/running_action_started_at_ms: Mutex<HashMap<String, u64>>/);
 assert.match(lib,/started\.insert\(action_id\.clone\(\),now_ms\(\)\)/);
 assert.match(lib,/started\.remove\(&action_id\)/);
});
test("desktop UI exposes observed state but never renders Rust lease timestamps as worker progress heartbeat",()=>{
 assert.match(ui,/invoke<NativeWorkerStatus>\("native_worker_status"\)/);
 assert.match(ui,/nativeHostStatusUnavailable/);
 assert.match(ui,/NOT a progress heartbeat/);
 assert.match(ui,/RECOVERY REQUIRED/);
 assert.match(ui,/window\.setInterval\(\(\) => void refreshNativeWorkerStatus\(\), 4000\)/);
 assert.doesNotMatch(ui,/progressHeartbeatVerified\s*=\s*true/);
});

test("real typed action journal is published before execution and finalized ONLY after audit",()=>{
 assert.match(lib,/mod native_worker_job;/);
 assert.match(lib,/native_worker_job::begin\(&app,&action_id,&active_tool,now_ms\(\)\)\?/);
 assert.match(lib,/SupervisorPulse::start\(app.clone\(\),action_id.clone\(\)\)/);
 assert.match(lib,/drop\(pulse\)/);
 assert.match(lib,/native_worker_job::audit\(&app,&action_id,result.success,now_ms\(\)\)\?/);
 assert.match(lib,/native_worker_job::audit\(&app,&action_id,false,now_ms\(\)\)\?/);
 assert.match(lib,/native_worker_job::require_resolved\(app\)\?/);
 assert.match(jobs,/Unresolved durable native worker job requires owner audit review/);
 assert.match(jobs,/fn tick_at\(/);
 assert.match(jobs,/thread::park_timeout\(HEARTBEAT_PERIOD\)/);
 assert.match(jobs,/Native job tick cannot renew another or finalized action/);
 assert.match(jobs,/Native job primary missing but backup present/);
 assert.match(jobs,/validate\(record\)\?/);
 assert.doesNotMatch(jobs,/auto_retry|auto_resume|force_unlock|release_lease/);
});
test("supervisor pulse cannot fabricate progress, cancel a desktop task or clear ownership",()=>{
 assert.match(status,/status.supervisor_health="supervisor_tick_stale"/);
 assert.match(status,/status.supervisor_health="rust_supervisor_observed"/);
 assert.match(status,/progress_heartbeat_verified:false/);
 assert.match(jobs,/A tick proves only the supervisor loop is alive/);
 assert.match(ui,/host.supervisorHealth==="rust_supervisor_observed"/);
 assert.match(ui,/host.supervisorHealth==="supervisor_tick_stale"/);
 assert.match(ui,/NOT a progress heartbeat/);
 assert.doesNotMatch(jobs,/execute_tool_with_action_id|claim_single_execution|send_chat/);
});
test("all native bridge lifecycle mutators check the durable job without bypassing OS lease",()=>{
 assert.equal((lib.match(/claim_monitored_native_execution\(state.inner\(\),&app\)\?/g)??[]).length,12);
 assert.equal((lib.match(/fn (?:premiere|photoshop|illustrator|animate|audition)_bridge_(?:start|stop)\(\n    state: State<'_, ActionState>,\n    app: AppHandle,/g)??[]).length,10);
});

test("durable native job replay history is bounded and survives restart without fabricated execution proof",()=>{
 assert.match(jobs,/MAX_PRIOR_ACTIONS:usize=24/);
 assert.match(jobs,/prior_action_ids:Vec<String>/);
 assert.match(jobs,/#\[serde\(default\)\]/);
 assert.match(jobs,/history\.push\(last\.action_id\)/);
 assert.match(jobs,/history\.drain\(\.\.excess\)/);
 assert.match(jobs,/last\.prior_action_ids\.iter\(\)\.any/);
 assert.match(jobs,/malformed_history_is_not_treated_as_empty_on_restart/);
 assert.match(jobs,/bounded_durable_replay_window_keeps_recent_audited_ids_after_rotation/);
 assert.match(status,/status\.tool\.as_deref\(\)!=Some\(job\.tool\.as_str\(\)\)/);
 assert.match(status,/audited_job_conflicts_with_live_lease/);
 assert.match(ui,/audited_job_conflicts_with_live_lease/);
 assert.doesNotMatch(jobs,/fn\s+(?:automatic_retry|force_release_worker|assume_completed)\s*\(/);
});

test("interrupted native jobs need owner confirmation, exact Rust audit binding and cross-process exclusion",()=>{
 assert.match(lib,/fn reconcile_native_worker_job\(/);
 assert.match(lib,/confirmation!="REVIEW UNKNOWN"/);
 assert.match(lib,/execution_lease::claim_single_execution\(&state\.native_execution_owned\)/);
 assert.match(lib,/native_worker_status::require_clear_for_new_dispatch\(&running,&started\)/);
 assert.match(lib,/read_action_audit_receipt\(&app,&action_id\)/);
 assert.match(lib,/native_worker_job::reconcile\(&app,&action_id,&tool,verified,now_ms\(\)\)/);
 assert.match(lib,/\s+reconcile_native_worker_job,\s/);
 assert.match(jobs,/owner_reviewed_unknown/);
 assert.match(jobs,/reviewed.audit_success/);
 assert.match(ui,/id="reviewNativeJob"/);
 assert.match(ui,/window\.prompt\(/);
 assert.match(ui,/"reconcile_native_worker_job"/);
 assert.match(status,/last_action_reviewed_unknown/);
 assert.doesNotMatch(jobs,/fn\s+(?:automatic_retry|auto_execute_recovery)\s*\(/);
});

test("bounded native multi-job history is bound to native begin/audit and explicit review",()=>{
 const history=readFileSync(new URL("../src-tauri/src/native_job_history.rs",import.meta.url),"utf8");
 assert.match(lib,/mod native_job_history;/);
 assert.match(lib,/native_job_history::before_next\(app,native_worker_job::read\(app\)\?\.as_ref\(\)\)\?/);
 assert.match(lib,/native_worker_job::begin\(&app,&action_id,&active_tool,now_ms\(\)\)\?;\s*native_job_history::begin\(&app\)\?/);
 assert.match(lib,/native_worker_job::audit\(&app,&action_id,result\.success,now_ms\(\)\)\?;\s*native_job_history::finish\(&app\)\?/);
 assert.match(lib,/native_worker_job::audit\(&app,&action_id,false,now_ms\(\)\)\?;\s*native_job_history::finish\(&app\)\?/);
 assert.match(lib,/native_worker_job::reconcile\(&app,&action_id,&tool,verified,now_ms\(\)\)\?;\s*native_job_history::finish\(&app\)\?/);
 assert.match(lib,/fn native_worker_history\(app:AppHandle\)/);
 assert.match(lib,/\s+native_worker_history,\s/);
 assert.match(history,/MAX_ITEMS:usize=48/);
 assert.match(history,/two_real_actions_survive_restart_and_duplicate_uuid_fails/);
 assert.match(history,/mismatched_corrupt_or_orphaned_records_fail_closed/);
 assert.doesNotMatch(history,/fn\s+(?:auto_retry|auto_resume|auto_execute)\s*\(/);
});

test("native history dashboard reads actual Rust records without granting worker authority",()=>{
 assert.match(lib,/fn native_worker_history\(app:AppHandle\)/);
 assert.match(ui,/invoke<NativeJobHistory>\("native_worker_history"\)/);
 assert.match(ui,/id="nativeActionHistoryList"/);
 assert.match(ui,/Native history unavailable/);
 assert.match(ui,/history\.items\.slice\(-8\)\.reverse\(\)/);
 assert.doesNotMatch(ui,/history\.items\.map\(.*execute_action/);
});

test("native scheduler is in permissioned execute_action rather than decorative queue",()=>{
 const schedule=readFileSync(new URL("../src-tauri/src/native_scheduler.rs",import.meta.url),"utf8");
 assert.match(lib,/mod native_scheduler;/);
 assert.match(lib,/native_scheduler::preflight\(&app,prepared\.task_graph\.as_ref\(\)/);
 assert.match(lib,/native_worker_job::begin\(&app,&action_id,&active_tool,now_ms\(\)\)\?/);
 assert.match(lib,/native_scheduler::begin\(&app,prepared\.task_graph\.as_ref\(\)/);
 assert.match(lib,/native_scheduler::finish\(&app,&action_id,&result\.tool,Some\(result\.success\)\)/);
 assert.match(lib,/native_scheduler::finish\(&app,&action_id,&native\.tool,Some\(false\)\)/);
 assert.match(lib,/native_scheduler::finish\(&app,&action_id,&tool,verified\)/);
 assert.match(lib,/fn native_scheduler_status\(/);
 assert.match(schedule,/fn allowed\(/);
 assert.match(schedule,/fn begin_at\(/);
 assert.match(schedule,/fn finish_at\(/);
 assert.match(schedule,/fn from_graph\(/);
 assert.match(schedule,/real_approved_steps_advance_when_exact_dependencies_are_audited/);
 assert.match(schedule,/restart_keeps_running_unknown_and_blocks_duplicate_dispatch/);
 assert.doesNotMatch(schedule,/fn\s+(?:auto_approve|auto_execute|blind_retry)\s*\(/);
});
