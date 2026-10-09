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

test("A22 metered non-Windows calls never silently bypass daily persisted accounting",()=>{
 const claim=guard.slice(guard.indexOf("pub(crate) fn claim_paid_attempt("),guard.indexOf("#[cfg(test)]",guard.indexOf("pub(crate) fn claim_paid_attempt(")));
 assert.match(claim,/if !is_metered\(provider,base_url\)/);
 assert.match(claim,/#\[cfg\(not\(windows\)\)\]/);
 assert.match(claim,/Metered AI requests are blocked on non-Windows runtimes/);
 assert.match(claim,/#\[cfg\(windows\)\]/);
 assert.match(claim,/reserve_durable_daily_attempt\(\)\?/);
 assert.match(guard,/metered_endpoints_are_rejected_without_durable_usage_journal/);
 assert.match(guard,/unmetered_local_ollama_is_allowed_without_touching_paid_usage/);
});

test("A22 exact model included in every native paid admission",()=>{
 const calls=[...rust.matchAll(/provider_request_guard::claim_paid_attempt\(([^;]+)\)\?/g)];
 assert.equal(calls.length,3);
 for(const [,args] of calls) assert.match(args,/\.(?:model)/);
 assert.match(guard,/usd_budget::reserve_approved_allowance\(provider,model,base_url\)\?/);
 assert.match(guard,/#\[cfg\(windows\)\]\s*mod usd_budget;/);
});

test("A22 rejects missing/unknown USD approval before consuming the paid attempt ledger",()=>{
 const guardClaim=guard.slice(guard.indexOf("pub(crate) fn claim_paid_attempt("),guard.indexOf("#[cfg(test)]",guard.indexOf("pub(crate) fn claim_paid_attempt(")));
 const auth=guardClaim.indexOf("usd_budget::preflight(provider,model,base_url)?");
 const firstAttempt=guardClaim.indexOf("reserve(&PAID_ATTEMPTS");
 assert.ok(auth>=0 && firstAttempt>auth,"unknown pricing must fail before consuming daily attempt counters");
});
