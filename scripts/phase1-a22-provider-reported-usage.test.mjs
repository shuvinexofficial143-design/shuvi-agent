import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const guard=readFileSync(new URL("../src-tauri/src/provider_request_guard.rs",import.meta.url),"utf8");
const usage=readFileSync(new URL("../src-tauri/src/provider_request_guard/reported_usage.rs",import.meta.url),"utf8");
test("A22 successful model responses append a durable provider-reported token receipt",()=>{
 const send=native.slice(native.indexOf("async fn send_chat("),native.indexOf("fn current_runtime_status(",native.indexOf("async fn send_chat(")));
 assert.match(send,/let result=match input.provider.as_str\(\)/);
 assert.match(send,/if let Ok\(ref response\)=result/);
 assert.match(send,/provider_request_guard::record_provider_reported_usage\(/);
 assert.match(send,/response\.usage\.as_ref\(\)/);
 assert.match(send,/DO NOT automatically retry/);
 assert.match(guard,/mod reported_usage;/);
 assert.match(guard,/reported_usage::append_receipt/);
});
test("A22 usage is not conflated with prices or actual provider invoices",()=>{
 assert.match(usage,/provider_usage_missing/);
 assert.match(usage,/provider_usage_unverified/);
 assert.match(usage,/provider_reported/);
 assert.match(usage,/"usd_billed":Value::Null/);
 assert.match(usage,/file|journal/);
 assert.match(usage,/f\.sync_all\(\)/);
 assert.match(usage,/\.share_mode\(0\)\.custom_flags\(super::OPEN_REPARSE_POINT\)/);
 assert.match(usage,/detects_corruption_and_prevents_silent_receipt_loss/);
});
test("A22 text adapter failures persist an unknown outcome without private error bodies or reservation refunds",()=>{
 const start=native.indexOf("async fn send_chat(");
 const send=native.slice(start,native.indexOf("fn current_runtime_status(",start));
 const failure=send.slice(send.indexOf("} else {"));
 assert.match(failure,/record_provider_unknown_outcome\(/);
 assert.doesNotMatch(failure,/result\.unwrap_err|result\.as_ref|refund|release_approved/);
 assert.match(failure,/DO NOT automatically retry/);
 assert.match(guard,/reported_usage::append_unknown_outcome/);
 assert.match(usage,/request_failed_or_unknown/);
 assert.match(usage,/failed_requests_keep_billing_and_tokens_unknown/);
});

test("A22 preflights the durable usage receipt journal before any paid request reservation",()=>{
 const claim=guard.slice(guard.indexOf("pub(crate) fn claim_paid_attempt("),guard.indexOf("pub(crate) fn record_provider_unknown_outcome("));
 const preflight=claim.indexOf("reported_usage::preflight_journal()?");
 const attempts=claim.indexOf("reserve(&PAID_ATTEMPTS");
 const durable=claim.indexOf("reserve_durable_daily_attempt()?");
 assert.ok(preflight>=0 && attempts>preflight && durable>preflight,"journal must be checked before paid admission");
 assert.match(usage,/pub\(super\) fn preflight_journal\(\)->Result<\(\),String>/);
 assert.match(usage,/ensure_room_for_receipt\(&bytes\)\?/);
 assert.match(usage,/preflight_rejects_corrupt_full_and_exhausted_receipt_journals/);
 assert.match(usage,/f\.sync_all\(\)/);
});
