import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const native=load("src-tauri/src/lib.rs");
const guard=load("src-tauri/src/provider_request_guard.rs");
test("Shuvi passes the exactly chosen provider request to Chat and Vision adapters",()=>{
 const names=["async fn send_chat(","async fn analyze_png_bytes_with_provider(","async fn analyze_png_frames_with_provider("];
 for(const name of names){
  assert.ok(native.includes(name));
 }
 assert.match(native,/validate_provider_fields/);
 assert.match(native,/load_api_key\(&input.provider\)/);
});
test("One user request is not automatically repeated after an uncertain paid HTTP attempt",()=>{
 const adapter=native.slice(native.indexOf("async fn openai_compatible_chat("),native.indexOf("fn current_runtime_status",native.indexOf("async fn openai_compatible_chat(")));
 assert.equal([...adapter.matchAll(/send_paid_generation_once\(request/g)].length,3);
 assert.doesNotMatch(adapter,/send_with_retry\(request/);
});
test("Shuvi records reported usage and retains local approval gates for tools",()=>{
 assert.match(guard,/record_provider_reported_usage/);
 assert.match(native,/fn prepare_tool\(/);
 assert.match(native,/fn deny_action\(/);
 assert.match(native,/fn execute_action\(/);
});
