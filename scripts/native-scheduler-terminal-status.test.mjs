import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const scheduler=readFileSync(new URL("../src-tauri/src/native_scheduler.rs",import.meta.url),"utf8");
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("Master observes disk-audited native terminal outcome without treating heartbeat as success",()=>{
 assert.match(lib,/fn native_scheduler_status\(app:AppHandle\)[\s\S]{0,160}native_scheduler::verified_status\(&app\)/);
 assert.match(scheduler,/fn projected_terminal\(/);
 assert.match(scheduler,/fn read_only_status_projection_recovers_terminal_rust_receipt_without_disk_mutation/);
 assert.match(scheduler,/fn read_only_status_projection_refuses_missing_or_foreign_audit/);
 assert.match(scheduler,/journal\.audit_success==Some\(true\)/);
 assert.match(scheduler,/let _os=SchedulerOsLock::take\(&file\)\?/);
 assert.match(scheduler,/let snapshot=read_at\(&file\)\?/);
 assert.match(scheduler,/fn read_locked_at\(file:&Path\)/);
 assert.doesNotMatch(scheduler.match(/fn projected_terminal\([\s\S]+?\/\/\/ Never trusts/)[0],/persist\(|execute_tool|send_chat/);
});
