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
 assert.doesNotMatch(jobs,/fn\s+(?:automatic_retry|force_release_worker|assume_completed)\s*\(/);
});
