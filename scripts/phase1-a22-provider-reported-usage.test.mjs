import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const native=load("src-tauri/src/lib.rs");
const guard=load("src-tauri/src/provider_request_guard.rs");
const usage=load("src-tauri/src/provider_request_guard/reported_usage.rs");
test("Provider-reported token usage continues after Chat and Vision responses",()=>{
 const region=native.slice(native.indexOf("async fn send_chat("),native.indexOf("fn current_runtime_status",native.indexOf("async fn send_chat(")));
 assert.match(region,/record_provider_reported_usage/);
 assert.match(region,/record_provider_unknown_outcome/);
 assert.match(region,/preserving actual provider response/);
 assert.match(region,/original provider error is preserved/);
 assert.match(guard,/reported_usage::append_receipt/);
});
test("Unknown outcomes and token reports stay distinct from actual billed USD",()=>{
 assert.match(usage,/request_failed_or_unknown/);
 assert.match(usage,/provider_usage_missing/);
 assert.match(usage,/provider_usage_unverified/);
 assert.match(usage,/provider_reported/);
 assert.match(usage,/"usd_billed":Value::Null/);
 assert.match(usage,/f\.sync_all\(\)/);
});
