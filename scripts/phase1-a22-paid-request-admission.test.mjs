import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const rust=read("src-tauri/src/lib.rs");
const guard=read("src-tauri/src/provider_request_guard.rs");
test("A22 chat and both vision methods reserve shared paid requests",()=>{
 const chat=rust.slice(rust.indexOf("async fn send_chat("),rust.indexOf("fn current_runtime_status",rust.indexOf("async fn send_chat(")));
 const single=rust.slice(rust.indexOf("async fn analyze_png_bytes_with_provider("),rust.indexOf("async fn analyze_png_frames_with_provider("));
 const multi=rust.slice(rust.indexOf("async fn analyze_png_frames_with_provider("),rust.indexOf("fn is_ignored_workspace_dir("));
 for(const method of [chat,single,multi]) assert.match(method,/provider_request_guard::claim_paid_attempt/);
 assert.match(rust,/mod provider_request_guard;/);
});
test("A22 three paid text providers send POST exactly once",()=>{
 const chat=rust.slice(rust.indexOf("async fn openai_compatible_chat("),rust.indexOf("fn current_runtime_status",rust.indexOf("async fn openai_compatible_chat(")));
 assert.equal([...chat.matchAll(/send_paid_generation_once\(request/g)].length,3);
 assert.doesNotMatch(chat,/send_with_retry\(request/);
 const once=rust.slice(rust.indexOf("async fn send_paid_generation_once("),rust.indexOf("async fn send_with_retry("));
 assert.match(once,/request\.send\(\)\.await/);
 assert.match(once,/do not automatically retry/);
 assert.doesNotMatch(once,/for attempt/);
});
test("A22 circuit breaker atomic across workers and labeled nonmonetary",()=>{
 assert.match(guard,/MAX_PAID_REQUEST_ATTEMPTS_PER_RUNTIME:usize=48/);
 assert.match(guard,/fetch_update\(Ordering::AcqRel,Ordering::Acquire/);
 assert.match(guard,/concurrently_enforces_same_runtime_limit/);
 assert.match(guard,/NOT a USD or daily budget/);
});
