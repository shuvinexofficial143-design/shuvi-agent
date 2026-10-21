import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/native_task_ai_ledger.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("native paid task reservation is checked by Rust before dispatch",()=>{
 const chat=lib.slice(lib.indexOf('async fn chat('),lib.indexOf('#[tauri::command]\nfn native_task_ai_usage'));
 const checkpoint=chat.indexOf('record.phase!="model_reserved"');
 const journal=chat.indexOf('native_task_ai_ledger::reserve(');
 const call=chat.indexOf('let answer=send_chat(input,key).await');
 assert.ok(checkpoint>=0&&journal>checkpoint&&call>journal);
 assert.ok(chat.includes('record.task_id.as_deref()!=Some(&ticket.task_id)'));
 assert.ok(chat.includes('record.model_requests!=ticket.request_index'));
 assert.ok(chat.includes('ticket.request_index>record.max_actions+1'));
 assert.ok(chat.includes('native_task_ai_ledger::complete('));
 assert.ok(lib.includes('native_task_ai_usage,'));
});
test("native AI receipts preserve unknown outcome and refuse replay",()=>{
 assert.ok(rust.includes('static LOCK:Mutex<()>=Mutex::new()'));
 assert.ok(rust.includes('handle.sync_all()'));
 assert.ok(rust.includes('rows.iter().any(|r|r.request_id==id)'));
 assert.ok(rust.includes('rows.len()+2>MAX_ROWS'));
 assert.ok(rust.includes('r.usd_billed.is_none()'));
 assert.ok(rust.includes('Some((5,3,8))'));
 assert.ok(rust.includes('b"{bad"'));
 assert.ok(rust.includes('pub(crate) fn complete('));
});
test("UI sends fresh Native Task only ticket and offers read-only unpriced receipts",()=>{
 assert.ok(ui.includes('const aiTicket=(budget:NativeTaskBudget)=>'));
 assert.ok(ui.includes('requestIndex:budget.modelRequests'));
 assert.ok(ui.includes('task_ai_ticket:ticket'));
 assert.ok(ui.includes('route.role==="chat"?null:aiTicket(taskBudget)'));
 assert.ok(ui.includes('...(ticket?{task_ai_ticket:ticket}:{})'));
 assert.ok(ui.includes('Show task AI request ledger'));
 assert.ok(ui.includes('USD billed: UNKNOWN'));
});
