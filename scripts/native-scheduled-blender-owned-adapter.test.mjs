import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const adapter=readFileSync(new URL("../src-tauri/src/native_blender_owned_adapter.rs",import.meta.url),"utf8");
const owned=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
const py=readFileSync(new URL("../integrations/blender-worker/shuvi_blender_bridge.py",import.meta.url),"utf8");
test("approved scheduled Blender inspection routes to exact PID-owned Rust worker",()=>{
 assert.match(lib,/mod native_blender_owned_adapter;/);
 assert.match(lib,/if scheduled_step\.is_some\(\)/);
 assert.match(lib,/ToolAction::BlenderInspect \{python_exe,blender_exe,blend_file,operation\}/);
 assert.match(lib,/native_blender_owned_adapter::inspect\(/);
 assert.match(lib,/native_blender_owned_adapter::inspect\([\s\S]*?else\{\s*execute_tool_with_action_id/);
 assert.match(lib,/native_worker_job::audit\(&app,&action_id,result\.success,now_ms\(\)\)\?/);
});
test("desktop lease is never released between contained process and Rust audit",()=>{
 assert.match(lib,/let mut native_slot=Some\(claim_monitored_native_execution/);
 assert.match(adapter,/native_slot\.take\(\)/);
 assert.match(adapter,/spawn_for_active_action\(/);
 assert.match(adapter,/child\.wait_bounded_with_host_budget\(state\)/);
 assert.match(adapter,/RegisteredOwnedPid::start\(state,child\.pid\(\)\)/);
 assert.match(adapter,/child\.reclaim_terminal_lease\(\)\?/);
 assert.match(adapter,/\*native_slot=Some\(returned\)/);
 assert.match(owned,/fn reclaim_terminal_lease\(&mut self\)/);
 assert.match(owned,/self\.final_phase\.is_none\(\)\|\|self\.child\.active_processes\(\)\?!=0/);
});
test("fixed Blender bridge persists bounded exclusive authenticated evidence",()=>{
 assert.match(py,/parser\.add_argument\("--result-file", type=Path\)/);
 assert.match(py,/target\.open\("xb"\)/);
 assert.match(py,/os\.fsync\(written\.fileno\(\)\)/);
 assert.match(adapter,/MAX_EVIDENCE:usize=1024\*1024/);
 assert.match(adapter,/verify_payload\(&evidence\.0,&work,operation\)/);
 assert.match(adapter,/authenticated_bridge_roundtrip/);
 assert.match(adapter,/rendering_allowed/);
 assert.doesNotMatch(adapter,/tauri::command|eval\(|arbitrary_shell/);
});
