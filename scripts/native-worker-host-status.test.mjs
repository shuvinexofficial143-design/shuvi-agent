import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const status=readFileSync(new URL("../src-tauri/src/native_worker_status.rs",import.meta.url),"utf8");
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
 assert.doesNotMatch(status,/execute_tool_with_action_id|claim_single_execution|send_chat/);
});
test("native desktop mutation sites reuse the original process-wide guard and never bypass stale identity checks",()=>{
 assert.match(lease,/claim_windows_desktop_lease\(/);
 assert.match(lib,/fn claim_monitored_native_execution\(/);
 assert.match(lib,/native_worker_status::require_clear_for_new_dispatch/);
 assert.equal((lib.match(/let _native_slot\s*=\s*claim_monitored_native_execution\(state\.inner\(\)\)\?;/g)??[]).length,12);
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
