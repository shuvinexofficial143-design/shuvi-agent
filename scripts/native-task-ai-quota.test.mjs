import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const quota=readFileSync(new URL("../src-tauri/src/native_task_ai_quota.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");

test("first paid native chat atomically issues immutable owner request-count cap",()=>{
 const chat=lib.slice(lib.indexOf("async fn chat("),lib.indexOf("fn native_task_ai_usage("));
 const issue=chat.indexOf("quotas.issue(&ticket.task_id,selected,record.expires_at,now_ms())?");
 const check=chat.indexOf("quotas.check(&ticket.task_id,ticket.request_index,now_ms())?");
 const reserve=chat.indexOf("native_task_ai_ledger::reserve(");
 const send=chat.indexOf("let answer=send_chat(input,key).await");
 assert.ok(issue>=0&&check>issue&&reserve>check&&send>reserve);
 assert.ok(chat.includes("record.staged_actions!=0||record.action_id.is_some()"));
 assert.ok(chat.includes('ticket.request_index==1'));
 assert.ok(chat.includes('ticket.max_requests.is_some()'));
 assert.ok(!lib.includes('fn issue_native_task_ai_quota('));
});

test("request limit never escalates or restores from an old checkpoint",()=>{
 assert.ok(quota.includes('const ALLOWED:&[u8]=&[2,4,8,16]'));
 assert.ok(quota.includes('Task AI request quota cannot be enlarged or reissued.'));
 assert.ok(quota.includes('Task AI quota missing after restart or revocation'));
 assert.ok(quota.includes('index>q.max as u32'));
 assert.ok(quota.includes('owner_limit_cannot_be_extended_or_restored_by_a_different_task'));
});

test("dashboard includes owner limit in the FIRST chat ticket without separate setup IPC",()=>{
 assert.ok(ui.includes('for(const count of [2,4,8,16])'));
 assert.ok(ui.includes('aiQuotaSelect.value="4"'));
 assert.ok(ui.includes('taskAiQuotas.set(taskBudget,selectedLimit)'));
 assert.ok(ui.includes('budget.modelRequests===1&&ownerLimit?{maxRequests:ownerLimit}:{}'));
 assert.ok(ui.includes('route.role==="chat"?null:aiTicket(taskBudget)'));
 assert.ok(!ui.includes('invoke<void>("issue_native_task_ai_quota"'));
 assert.ok(ui.includes('ownerBudget.modelRequests>=(taskAiQuotas.get(ownerBudget)??0)'));
 assert.ok(ui.includes('taskBudget.modelRequests>=(taskAiQuotas.get(taskBudget)??0)'));
 assert.ok(ui.includes('owner_paid_request_quota_exhausted'));
 assert.ok(ui.includes('These are not token, USD spending or verified billing caps.'));
 assert.ok(ui.includes('256 KiB input limit each and 512 KiB cumulative'));
 const preflight=lib.slice(lib.indexOf("async fn chat("),lib.indexOf("fn native_task_ai_usage("));
 assert.ok(preflight.includes('quotas.reserve_context(&ticket.task_id,ticket.request_index,input_bytes,now_ms())?'));
 assert.ok(preflight.indexOf('quotas.reserve_context(')<preflight.indexOf('native_task_ai_ledger::reserve('));
 assert.ok(quota.includes('const MAX_REQUEST_CONTEXT_BYTES:usize=256*1024'));
 assert.ok(quota.includes('const MAX_TASK_CONTEXT_BYTES:usize=512*1024'));
 assert.ok(quota.includes('grant.committed_context_bytes=cumulative;'));
 assert.ok(quota.includes('grant.next_request_index=index+1;'));
});

test("native Rust caps output tokens at provider request for only paid owner tasks",()=>{
 const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 assert.ok(lib.includes("const MAX_NATIVE_TASK_OUTPUT_TOKENS: u32 = 2048"));
 assert.ok(lib.includes("native_task_output_tokens: Option<u32>"));
 assert.ok(lib.includes("input.native_task_output_tokens=Some(MAX_NATIVE_TASK_OUTPUT_TOKENS);"));
 for(const adapter of [
  "payload[output_key] = json!(input.native_task_output_tokens.unwrap_or(MAX_PROVIDER_OUTPUT_TOKENS))",
  '"generationConfig": { "maxOutputTokens": input.native_task_output_tokens.unwrap_or(MAX_PROVIDER_OUTPUT_TOKENS) }',
  '"max_tokens": input.native_task_output_tokens.unwrap_or(2048)'
 ])assert.ok(lib.includes(adapter),adapter);
 const reserve=lib.indexOf("native_task_ai_ledger::reserve(&app,&ticket.task_id,");
 const taskCap=lib.indexOf("input.native_task_output_tokens=Some(MAX_NATIVE_TASK_OUTPUT_TOKENS);");
 const send=lib.indexOf("let answer=send_chat(input,key).await;",reserve);
 assert.ok(reserve>0&&taskCap>reserve&&send>taskCap);
});


test("all internal ChatInput constructors explicitly carry non-native output policy",()=>{
 const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 const constructs=[...lib.matchAll(/\bChatInput\s*\{/g)];
 // Definition + both motion-graphics constructors; future constructors must be
 // reviewed when the internal max-output field changes.
 assert.equal(constructs.length,3,"unexpected ChatInput constructor requires audit");
 const generated=lib.slice(lib.indexOf("ToolAction::MotionGraphicsGeneratePlan {request,provider} =>"));
 const corrected=lib.slice(lib.indexOf("ToolAction::MotionGraphicsGenerateCorrection {request,provider} =>"));
 assert.match(generated,/task_ai_ticket:None,\s*(?:\/\/[^\n]*\n\s*)*native_task_output_tokens:None,/);
 assert.match(corrected,/task_ai_ticket:None,\s*(?:\/\/[^\n]*\n\s*)*native_task_output_tokens:None,/);
 assert.match(lib,/input\.native_task_output_tokens=Some\(MAX_NATIVE_TASK_OUTPUT_TOKENS\);/);
});
