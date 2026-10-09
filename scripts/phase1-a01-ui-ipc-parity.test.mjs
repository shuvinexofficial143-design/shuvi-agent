import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
// Source-level A01 / A17 command contract gate. No guarantee of a live,
// built or deployed Windows backend without signed Windows acceptance.
const invokeCalls=[...ui.matchAll(/\binvoke(?:<[^(\n]+>)?\s*\(/g)];
const staticCalls=[...ui.matchAll(/\binvoke(?:<[^(\n]+>)?\s*\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)].map(x=>x[1]);
const handlerMatch=native.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/);
const declared=handlerMatch?handlerMatch[1].split(",").map(x=>x.trim()).filter(Boolean):[];
const aliases=declared.map(x=>x.split("::").at(-1));
const uniqueNames=[
  "action_audit_receipt",
  "audit_log",
  "cancel_running_action",
  "chat",
  "clear_session_checkpoint",
  "delete_api_key",
  "deny_action",
  "execute_action",
  "export_diagnostics",
  "get_workspace",
  "list_providers",
  "load_session_checkpoint",
  "premiere_bridge_start",
  "premiere_bridge_status",
  "premiere_bridge_stop",
  "prepare_powershell",
  "prepare_tool",
  "record_agent_event",
  "remote_agent_disconnect",
  "remote_agent_pair",
  "remote_agent_poll",
  "remote_agent_receipt",
  "remote_agent_status",
  "runtime_status",
  "save_api_key",
  "save_session_checkpoint",
  "set_workspace",
  "web_bridge_start",
  "web_bridge_stop"
];

test("A01 each real UI invoke is statically declared (no dynamic IPC target)",()=>{
 assert.equal(invokeCalls.length,staticCalls.length,"Dynamic or unreviewed native command invocation");
 assert.deepEqual([...new Set(staticCalls)].sort(),uniqueNames);
});
test("A01 every UI IPC name resolves to a live Tauri handler, including qualified web bridge aliases",()=>{
 assert.ok(handlerMatch,"missing Rust Tauri handler");
 assert.equal(new Set(aliases).size,aliases.length,"duplicate registered command alias");
 for(const name of uniqueNames) assert.ok(aliases.includes(name),"UI invokes missing Rust command: "+name);
 for(const name of ["remote_agent_status","remote_agent_pair","remote_agent_disconnect","remote_agent_poll","remote_agent_receipt"]){
   assert.ok(declared.includes("remote_agent::"+name),"remote Windows API alias missing: "+name);
 }
 for(const name of ["web_bridge_start","web_bridge_stop"]){
   assert.ok(declared.includes("web_bridge::"+name),"read-only Web UI bridge alias missing");
 }
});
test("A01 approval/cancellation from UI still connects to native action authority",()=>{
 for(const name of ["prepare_tool","execute_action","cancel_running_action","deny_action","action_audit_receipt"]){
   assert.ok(staticCalls.includes(name),name+" UI wiring missing");
   assert.ok(aliases.includes(name),name+" native wiring missing");
 }
 const nativeExecute=native.slice(native.indexOf("async fn execute_action("),native.indexOf("async fn execute_powershell("));
 assert.match(nativeExecute,/execution_lease::claim_single_execution\(&state.native_execution_owned\)\?/);
});
