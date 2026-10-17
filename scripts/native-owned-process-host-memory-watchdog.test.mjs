import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const owned=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
const adapter=readFileSync(new URL("../src-tauri/src/native_blender_owned_adapter.rs",import.meta.url),"utf8");
const plan=readFileSync(new URL("../src-tauri/src/native_blender_owned_plan.rs",import.meta.url),"utf8");
test("scheduled Blender inspector and plan both register exact OS PID in host budget accounting",()=>{
 assert.match(lib,/native_blender_owned_adapter::inspect\(\s*&app,state\.inner\(\),&mut native_slot/);
 assert.match(lib,/native_blender_owned_plan::execute\(\s*&app,state\.inner\(\),&mut native_slot/);
 for(const s of [adapter,plan]){
  assert.match(s,/RegisteredOwnedPid::start\(state,child\.pid\(\)\)\?/);
  assert.match(s,/drop\(tracked\)/);
 }
 assert.match(adapter,/child\.wait_bounded_with_host_budget\(state\)/);
 assert.match(plan,/child\.wait_bounded_with_host_budget_and_progress\(/);
 assert.match(plan,/state,\|\|progress\.observe\(\)/);
 assert.match(owned,/wait_bounded_with_probe_and_progress/);
 assert.match(owned,/current_runtime_status\(state\)/);
});
test("supervised process checks original combined RAM guard and fail-closes on unavailable observation",()=>{
 assert.match(owned,/register_managed_process\(state,pid\)\?/);
 assert.match(owned,/unregister_managed_process\(self\.state,self\.pid\)/);
 assert.match(owned,/current_runtime_status\(state\)/);
 assert.match(owned,/status\.over_hard_limit/);
 assert.match(owned,/wait_bounded_with_probe/);
 assert.match(owned,/real_windows_job_stops_when_host_memory_probe_reports_over_limit/);
 assert.match(owned,/unavailable_host_memory_probe_also_stops_exact_owned_job/);
 assert.match(owned,/self\.stop_owned_tree\("cancelled"\)\?/);
 assert.match(owned,/Cannot independently verify owned Blender memory/);
 assert.doesNotMatch(owned,/status\.over_hard_limit.*safe_to_auto_retry\s*=\s*true/);
});
