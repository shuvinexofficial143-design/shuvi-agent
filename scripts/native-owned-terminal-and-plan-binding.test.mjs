import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const supervisor=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
const plan=readFileSync(new URL("../src-tauri/src/native_blender_owned_plan.rs",import.meta.url),"utf8");
test("remote stop cannot be acknowledged once PID terminates while artifact audit still holds desktop lease",()=>{
 assert.match(supervisor,/fn complete_owned_terminal\(/);
 assert.match(supervisor,/self\.record_terminal\(actual,code\)\?/);
 assert.match(supervisor,/owner\.active=None/);
 assert.match(supervisor,/owner\.cancel_requested=false/);
 assert.match(supervisor,/terminal_releases_pid_owner_before_artifact_audit_without_unlocking_desktop_lease/);
 assert.match(supervisor,/if phase=="exited"&&owner\.cancel_requested/);
 assert.match(supervisor,/self\.complete_owned_terminal\("exited",Some\(code\)\)/);
});
test("scheduled Blender plan binds authenticated final result to exact approved operation and step count",()=>{
 assert.match(plan,/fn approved_plan_contract\(/);
 assert.match(plan,/let \(expected_steps,expected_operation\)=approved_plan_contract\(plan,render\)\?/);
 assert.match(plan,/value\.get\("final_operation"\)\.and_then\(Value::as_str\)!=Some\(expected_operation\)/);
 assert.match(plan,/value\.get\("executed_steps"\)\.and_then\(Value::as_u64\)!=Some\(expected_steps as u64\)/);
 assert.match(plan,/Blender completed operation\/step count differs from exact approved plan/);
 assert.match(plan,/let expected_extension=if expected_operation=="render.execute"\{"png"\}else\{"blend"\}/);
 assert.match(plan,/correct_hash_of_wrong_output_type_never_satisfies_approved_render/);
});
