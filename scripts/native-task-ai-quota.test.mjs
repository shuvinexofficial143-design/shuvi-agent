import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const quota=readFileSync(new URL("../src-tauri/src/native_task_ai_quota.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("Rust enforces owner count quota before paid request ledger and dispatch",()=>{
 const begin=lib.indexOf('async fn chat('),end=lib.indexOf('fn issue_native_task_ai_quota(');
 const chat=lib.slice(begin,end);
 const checked=chat.indexOf('.check(&ticket.task_id,ticket.request_index,now_ms())?;');
 const reserved=chat.indexOf('native_task_ai_ledger::reserve(');
 const sent=chat.indexOf('let answer=send_chat(input,key).await');
 assert.ok(checked>=0&&reserved>checked&&sent>reserved);
 assert.ok(lib.includes('issue_native_task_ai_quota,'));
 assert.ok(lib.includes('recovery.phase!="model_reserved"||recovery.model_requests!=1'));
 assert.ok(lib.includes('recovery.staged_actions!=0||recovery.action_id.is_some()'));
});
test("native request count cannot be extended or reused by unrelated task",()=>{
 assert.ok(quota.includes('const ALLOWED:&[u8]=&[2,4,8,16]'));
 assert.ok(quota.includes('Task AI request quota cannot be enlarged or reissued.'));
 assert.ok(quota.includes('Task AI quota missing after restart or revocation'));
 assert.ok(quota.includes('index>q.max as u32'));
 assert.ok(quota.includes('owner_limit_cannot_be_extended_or_restored_by_a_different_task'));
});
test("owner choice is issued before first paid task call, ordinary Chat unaffected",()=>{
 assert.ok(ui.includes('for(const count of [2,4,8,16])'));
 assert.ok(ui.includes('aiQuotaSelect.value="4"'));
 assert.ok(ui.includes('if(route.role!=="chat"&&!ownerBudget)'));
 assert.ok(ui.includes('issue_native_task_ai_quota'));
 const first=ui.slice(ui.indexOf('async send(text,threadId'));
 assert.ok(first.indexOf('issue_native_task_ai_quota')<first.indexOf('const ticket=route.role==="chat"'));
 assert.ok(ui.includes('This is not a USD spending cap or verified bill.'));
});
