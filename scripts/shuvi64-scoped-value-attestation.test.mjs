import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const auth=readFileSync(new URL("../src-tauri/src/native_task_authorization.rs",import.meta.url),"utf8");
test("scoped UIA value evidence is structured after OS-bound readback",()=>{
 const start=lib.indexOf("ToolAction::UiSetValue { name, automation_id, window, value } => {");
 const stop=lib.indexOf("ToolAction::UiFocus { name, automation_id, window } => {",start);
 assert.ok(start>0&&stop>start);
 const code=lib.slice(start,stop);
 for (const term of ["$shuviValuePattern.SetValue","$readbackValue","Assert-ShuviNativeTarget",
 "ObservedWindowHwnd","ObservedWindowPid","ObservedWindowProcessStartTicks","AutomationId",
 "VerifiedValue = $true","ConvertTo-Json -Compress"])assert.ok(code.includes(term),term);
 assert.ok(!code.includes("'Value state verified on element:'"));
});
test("Rust task scope must require value witness before audit, and block repeat edit",()=>{
 for(const term of ["confirmed_value_edit","VerifiedValue","Scoped ValuePattern success requires Rust-verified OS readback.",
 "fn scoped_value_success_requires_exact_rust_verified_native_readback",
 "g.awaiting_readback=g.scope.exact_controls.first().cloned()"])assert.ok(auth.includes(term),term);
});
