import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const kernel=readFileSync(new URL("../src-tauri/src/native_task_authorization.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("M1.5 owner has separate Windows-native, time and action bounded exact-control approval",()=>{
 assert.match(lib,/fn issue_native_value_task_scope\(/);
 assert.match(lib,/fn confirm_native_value_task\(/);
 assert.match(lib,/MessageBoxW\(0,text\.as_ptr\(\),caption\.as_ptr\(\),0x0000_0134\)/);
 assert.match(lib,/scope\.exact_controls\.len\(\)!=1/);
 assert.match(lib,/scope\.max_actions>12/);
 assert.match(lib,/issue_native_value_task_scope,/);
 assert.match(ui,/chatAllowNativeValueTask/);
 assert.match(ui,/invoke<string>\("issue_native_value_task_scope"/);
 assert.match(ui,/exactControls:\[control\]/);
 assert.match(ui,/tools:\["ui_find","ui_set_value"\]/);
});
test("M1.5 Rust admission is based on bound original OS control, not model assertion",()=>{
 assert.match(kernel,/pub\(crate\) fn native_value_prepared\(/);
 assert.match(kernel,/bound\.automation_id\.as_str\(\)!=control\.as_str\(\)/);
 assert.match(kernel,/bound\.process_start_ticks<=0/);
 assert.match(lib,/original prepared edit expired|Original prepared edit expired/);
 assert.match(lib,/origin\.native_uia_target\.as_ref\(\)/);
 assert.match(lib,/ToolAction::UiSetValue\{\.\.\}/);
 assert.match(lib,/reserve_after_native_preflight\(&app,scope_id,&action,now_ms\(\)\)/);
});
test("M1.5 no second edit until separately audited same-control readback",()=>{
 assert.match(kernel,/awaiting_readback:Option<String>/);
 assert.match(kernel,/if action\.tool!="ui_find"\|\|action\.control_id\.as_deref\(\)!=Some\(control\)/);
 assert.match(kernel,/Post-edit inspection needs exactly one control/);
 assert.match(kernel,/Post-edit UIA control changed or was not observed/);
 assert.match(kernel,/g\.awaiting_readback=g\.pending\.as_ref\(\)\.and_then\(\|p\|p\.control_id\.clone\(\)\)/);
 assert.match(kernel,/fn bounded_native_value_edits_require_exact_control_and_new_inspection/);
 assert.match(ui,/readScope\.window===nativeUiTaskWindow\(proposal\)/);
 assert.match(ui,/readScope\.control===null/);
 assert.match(ui,/proposal\.arguments\?\.automation_id===readScope\.control/);
});
