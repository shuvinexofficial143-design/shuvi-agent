import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const guard=load("src-tauri/src/provider_request_guard.rs");
const receipts=load("src-tauri/src/provider_request_guard/reported_usage.rs");
test("Receipt journaling remains observational, not a provider invoice",()=>{
 assert.match(guard,/record_provider_reported_usage/);
 assert.match(guard,/record_provider_unknown_outcome/);
 assert.match(receipts,/"usd_billed":Value::Null/);
 assert.match(receipts,/Sha256::digest\(text\.as_bytes\(\)\)/);
});
test("Receipt file access retains Windows safety checks",()=>{
 assert.match(guard,/has_windows_reparse/);
 assert.match(guard,/OPEN_REPARSE_POINT/);
 assert.match(guard,/verify_journal_file_candidate/);
 assert.match(receipts,/\.share_mode\(0\)\.custom_flags/);
});
