import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const guard=readFileSync(new URL("../src-tauri/src/provider_request_guard.rs",import.meta.url),"utf8");
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("A22 Windows paid API reservation persists before provider network POST",()=>{
 assert.match(guard,/reserve_durable_daily_attempt\(\)\?/);
 assert.match(guard,/MAX_DAILY_PAID_ATTEMPTS:usize=48/);
 assert.match(guard,/paid-ai-attempts-utc-\{day\}\.log/);
 assert.match(guard,/\.share_mode\(0\)\.open\(&path\)/);
 assert.match(guard,/journal\.sync_all\(\)/);
 const claim=native.slice(native.indexOf("async fn send_chat("),native.indexOf("fn current_runtime_status",native.indexOf("async fn send_chat(")));
 assert.match(claim,/claim_paid_attempt/);
});
test("A22 invalid/partial/missing daily usage journal fails closed without silently resetting it",()=>{
 assert.match(guard,/read_attempt_count\(&data,MAX_DAILY_PAID_ATTEMPTS\)\?/);
 assert.match(guard,/journal\.chunks_exact\(2\)\.any/);
 assert.match(guard,/record!=b"1\\n"\.as_slice\(\)/);
 assert.match(guard,/Cannot reserve a billable AI attempt/);
 assert.match(guard,/journal exceeds its expected bounds/);
 assert.match(guard,/has_windows_reparse\(&folder_meta\)/);
 assert.match(guard,/has_windows_reparse\(&meta\)/);
});
test("A22 runtime and daily safety limits are different from money budgets",()=>{
 assert.match(guard,/MAX_PAID_REQUEST_ATTEMPTS_PER_RUNTIME:usize=48/);
 assert.match(guard,/MAX_DAILY_PAID_ATTEMPTS:usize=48/);
 assert.match(guard,/NOT a dollar budget/);
 assert.match(guard,/NOT a USD budget or a guarantee about provider pricing/);
 assert.match(guard,/durable_journal_rejects_partial_or_edited_records/);
});
