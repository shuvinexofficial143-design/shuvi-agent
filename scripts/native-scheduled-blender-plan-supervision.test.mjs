import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const native=readFileSync(new URL("../src-tauri/src/native_blender_owned_plan.rs",import.meta.url),"utf8");
const py=readFileSync(new URL("../integrations/blender-worker/shuvi_blender_plan.py",import.meta.url),"utf8");
test("approved scheduled Blender PLAN (not ad-hoc) uses the PID-owned process manager",()=>{
 assert.match(lib,/mod native_blender_owned_plan;/);
 assert.match(lib,/if scheduled_step\.is_some\(\)/);
 assert.match(lib,/ToolAction::BlenderRunPlan \{/);
 assert.match(lib,/native_blender_owned_plan::execute\(/);
 assert.match(native,/spawn_for_active_action\(/);
 assert.match(native,/Duration::from_secs\(120\)/);
 assert.match(native,/child\.reclaim_terminal_lease\(\)\?/);
 assert.match(native,/status\.phase!="exited"\|\|status\.exit_code!=Some\(0\)/);
});
test("Blender plan preserves authorizations and verified on-disk artifact attestation",()=>{
 assert.match(native,/if render\{args\.push\(OsString::from\("--allow-render"\)\);\}/);
 assert.match(py,/if any\(step\.request\.operation == "render\.execute"/);
 assert.match(py,/allow_destructive=False/);
 assert.match(native,/blender_plan_worker::verify_output\(&value,output_dir\)/);
 assert.match(native,/authenticated_blender_plan/);
 assert.match(native,/render_approved/);
 assert.match(native,/destructive_allowed/);
 assert.match(native,/MAX_PLAN_BYTES:usize=64\*1024/);
});
test("private Blender plan response remains optional for old stdout adapter",()=>{
 assert.match(py,/parser\.add_argument\("--result-file", type=Path\)/);
 assert.match(py,/target\.open\("xb"\)/);
 assert.match(py,/os\.fsync\(output\.fileno\(\)\)/);
 assert.match(py,/else:\s+print\(payload\)/);
 assert.doesNotMatch(native,/tauri::command|shell\(|eval\(/);
});
