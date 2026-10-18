import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../src-tauri/src/native_process_receipt.rs",import.meta.url),"utf8");
test("PID registration, owner Stop, OS terminal and review hold one kernel lock",()=>{
 assert.match(s,/struct CrossProcessReceiptLock/);
 assert.match(s,/share_mode\(0\)/);
 assert.match(s,/flock\(handle\.as_raw_fd\(\),2\|4\)/);
 const markers=["fn begin_at(","fn started_at(","fn finish_at(",
     "fn mark_cancel_requested_at(","fn owner_review_at("];
 for(const name of markers){
     const from=s.indexOf(name),to=s.indexOf("\n}",from);
     assert.ok(from>=0&&to>from);
     const body=s.slice(from,to);
     assert.match(body,/CrossProcessReceiptLock::take\(file\)\?/);
     assert.ok(body.indexOf("CrossProcessReceiptLock::take(file)")<body.indexOf("read_at(file)"));
 }
 assert.match(s,/read_locked_at\(&path\(app\)\?\)/);
});
test("durable Stop-vs-exit race and false PID progress remain guarded",()=>{
 assert.match(s,/stop_vs_terminal_race_cannot_erase_acknowledged_owner_stop/);
 assert.match(s,/subprocess_receipt_os_lock_blocks_stop_pid_and_terminal_publication/);
 assert.match(s,/fake_receipt_lock_directory_cannot_authorize_launch/);
 assert.match(s,/r\.app_progress_verified/);
 assert.match(s,/r\.phase=="exited"&&r\.cancel_requested/);
 assert.doesNotMatch(s,/tauri::command|invoke_handler/);
});
