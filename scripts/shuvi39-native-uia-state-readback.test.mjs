import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const branches=["UiSetValue","UiToggle","UiExpandCollapse","UiClick","UiFocus","UiScroll","UiSendKeys"];
function arm(tool){
 const marker="        ToolAction::"+tool+" {";
 const start=rust.indexOf(marker,570000);
 assert.ok(start>=0,"native action "+tool+" not found");
 const end=rust.indexOf("\n        ToolAction::",start+marker.length);
 return rust.slice(start,end<0?rust.length:end);
}
test("SetValue verifies the exact approved value using ValuePattern.Current, not just invocation",()=>{
 const source=arm("UiSetValue");
 const invoke=source.indexOf("$shuviValuePattern.SetValue('{escaped_value}')");
 const read=source.indexOf("$readbackValue");
 const mismatch=source.indexOf("readback differs from requested value");
 assert.ok(invoke>=0&&read>invoke&&mismatch>read);
 assert.match(source,/\[System\.StringComparison\]::Ordinal/);
 assert.match(source,/throw 'UIA ValuePattern readback differs/);
 assert.match(source,/Value state verified on element/);
});
test("Toggle checks a real before and after state transition",()=>{
 const source=arm("UiToggle");
 const before=source.indexOf("$toggleBefore = ");
 const mutation=source.indexOf("$togglePattern.Toggle()");
 const after=source.indexOf("$toggleAfter = ");
 const mismatch=source.indexOf("state transition");
 assert.ok(before>=0&&mutation>before&&after>mutation&&mismatch>after);
 assert.match(source,/if \([^\n]*\$toggleAfter -eq \$toggleBefore/);
 assert.match(source,/outcome requires independent inspection/);
});
test("ExpandCollapse checks actual state against approved Expand or Collapse",()=>{
 const source=arm("UiExpandCollapse");
 const mutation=source.indexOf("$expand.{method}()");
 const after=source.indexOf("$expand.Current.ExpandCollapseState");
 assert.ok(mutation>=0&&after>mutation);
 assert.match(source,/ExpandCollapseState\]::Expanded/);
 assert.match(source,/ExpandCollapseState\]::Collapsed/);
 assert.match(source,/if \('\{method\}' -eq 'Collapse'\)/);
 assert.match(source,/throw 'UIA ExpandCollapsePattern readback/);
});
test("all three state-proven tools still require original Rust-prepared HWND/PID",()=>{
 for(const tool of ["UiSetValue","UiToggle","UiExpandCollapse"]){
  const source=arm(tool);
  assert.match(source,/native_uia_target\.as_ref\(\)/);
  assert.match(source,/Assert-ShuviNativeTarget -root \$root -element \$e/);
  assert.match(source,/let output = run_hidden_powershell\(&script\)\?/);
  assert.match(source,/if !output\.status\.success\(\)/);
 }
});
test("generic Invoke/Click, SendKeys and Scroll do not claim a proven visible user objective",()=>{
 assert.doesNotMatch(arm("UiClick"),/Value state verified/);
 assert.doesNotMatch(arm("UiSendKeys"),/Toggle state changed and read back/);
 assert.doesNotMatch(arm("UiScroll"),/ExpandCollapsePattern readback/);
});

test("native UIA focus waits boundedly for readback on SAME approved control",()=>{
 const source=arm("UiFocus");
 const focus=source.indexOf("$e.SetFocus()");
 const check=source.indexOf("$e.Current.HasKeyboardFocus");
 const fail=source.indexOf("UIA focus not confirmed");
 assert.ok(focus>=0&&check>focus&&fail>check);
 assert.match(source,/for \(\$shuviAttempt=0; \$shuviAttempt -lt 5;/);
 assert.match(source,/Assert-ShuviNativeTarget -root \$root -element \$e/);
 assert.match(source,/Keyboard focus read back/);
});
test("vertical scrolling checks boundary and actual direction, not just a ScrollPattern invocation",()=>{
 const source=arm("UiScroll");
 const before=source.indexOf("$shuviBeforePercent");
 const boundary=source.indexOf("UIA scroll is already at the requested boundary");
 const mutate=source.indexOf("$shuviScrollPattern.Scroll(");
 const after=source.indexOf("$shuviAfterPercent");
 const reject=source.indexOf("Native UIA scroll did not show");
 assert.ok(before>0&&boundary>before&&mutate>boundary&&after>mutate&&reject>after);
 assert.match(source,/\$shuviWantIncrement/);
 assert.match(source,/Native vertical scroll movement verified/);
 assert.match(source,/Assert-ShuviNativeTarget -root \$root -element \$e/);
 assert.match(source,/for \(\$shuviAttempt=0; \$shuviAttempt -lt 5;/);
});
test("SelectionItem clicks independently read back actual IsSelected state",()=>{
 const source=arm("UiClick");
 const mutate=source.indexOf("$shuviSelectedItem.Select()");
 const inspect=source.indexOf("$shuviSelectedItem.Current.IsSelected");
 assert.ok(mutate>=0&&inspect>mutate);
 assert.match(source,/SelectionItem state verified/);
 assert.match(source,/UIA SelectionItem action has no confirmed selected state/);
});
test("InvokePattern cannot falsely assert a visible postcondition",()=>{
 const source=arm("UiClick");
 const invoke=source.indexOf("Invoke()");
 const selected=source.indexOf("SelectionItemPattern]$pattern");
 assert.ok(invoke>=0&&selected>invoke);
 const invokeSection=source.slice(invoke,selected);
 assert.doesNotMatch(invokeSection,/state verified|project saved|goal complete/i);
});
test("Native UIA approval ages out before durable execution while unrelated tools preserve global TTL",()=>{
 const fn=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_action(")+2600);
 assert.match(fn,/native_uia_window_guard::expired_native_uia_binding/);
 assert.match(fn,/prepared.native_uia_target.as_ref\(\)/);
 assert.match(fn,/PENDING_ACTION_TTL_MS/);
 const expired=rust.slice(rust.indexOf("if let Some(action) = expired_action {",rust.indexOf("async fn execute_action(")),
   rust.indexOf("let action = action.ok_or_else",rust.indexOf("async fn execute_action(")));
 assert.match(expired,/event: "denied"\.into\(\)/);
 assert.doesNotMatch(expired,/execute_tool_with_action_id\(/);
});

test("ValuePattern performs exactly one mutation and bounded independent state polling",()=>{
 const source=arm("UiSetValue");
 assert.equal((source.match(/\$shuviValuePattern\.SetValue\(/g)||[]).length,1);
 assert.match(source,/for \(\$shuviAttempt=0; \$shuviAttempt -lt 5;/);
 assert.match(source,/Assert-ShuviNativeTarget -root \$root -element \$e/);
 assert.match(source,/StringComparison\]::Ordinal/);
 assert.match(source,/if \(-not \$shuviValueVerified\)/);
});
test("Toggle and ExpandCollapse never automatically repeat their mutations during state wait",()=>{
 for(const [name,pattern] of [
  ["UiToggle",/\$togglePattern\.Toggle\(\)/g],
  ["UiExpandCollapse",/\$expand\.\{method\}\(\)/g]]){
  const source=arm(name);
  assert.equal((source.match(pattern)||[]).length,1,name);
  assert.match(source,/for \(\$shuviAttempt=0; \$shuviAttempt -lt 5;/);
  assert.match(source,/Assert-ShuviNativeTarget -root \$root -element \$e/);
 }
});
test("UI selection polls only read-only state; never clicks repeatedly after uncertain outcome",()=>{
 const source=arm("UiClick");
 assert.equal((source.match(/\$shuviSelectedItem\.Select\(\)/g)||[]).length,1);
 assert.match(source,/for \(\$shuviAttempt=0; \$shuviAttempt -lt 5;/);
 assert.match(source,/if \(-not \$shuviSelectionVerified\)/);
 assert.match(source,/Assert-ShuviNativeTarget -root \$root -element \$e/);
});
