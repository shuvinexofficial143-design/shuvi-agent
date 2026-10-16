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
 const invoke=source.indexOf(").SetValue('{escaped_value}')");
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
 assert.match(source,/if \(\$toggleAfter -eq \$toggleBefore\)/);
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
