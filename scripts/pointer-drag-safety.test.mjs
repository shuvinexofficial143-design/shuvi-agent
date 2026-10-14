import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/master-worker-queue.mjs",import.meta.url),"utf8");

test("bounded coordinate drag stays inside normal permissioned native action path",()=>{
  assert.match(rust,/\| "pointer_drag"/);
  assert.match(rust,/"pointer_drag" => \{/);
  assert.match(rust,/ToolAction::PointerDrag\{x1,y1,x2,y2,duration_ms\}/);
  assert.match(rust,/RiskLevel::High/);
  assert.match(rust,/duration_ms must be between 120 and 2500/);
  assert.match(rust,/arg_i32\(&proposal\.arguments,"x1"\)/);
  assert.match(rust,/arg_i32\(&proposal\.arguments,"y2"\)/);
  assert.match(worker,/"pointer_drag"/);
});
test("drag uses a fixed bounded PowerShell helper, and always releases the mouse",()=>{
  const a=rust.indexOf("ToolAction::PointerDrag {x1,y1,x2,y2,duration_ms} =>");
  assert.ok(a>0);
  const b=rust.indexOf("ToolAction::MotionGraphicsValidatePlan {plan} =>",a);
  const body=rust.slice(a,b);
  assert.match(body,/run_hidden_powershell\(&script\)/);
  assert.match(body,/\$i -le 24/);
  assert.match(body,/VirtualScreen/);
  assert.match(body,/SetCursorPos/);
  assert.match(body,/try \{\{/);
  assert.match(body,/\}\} finally \{\{/);
  assert.match(body,/if\(\$pressed\)/);
  assert.match(body,/mouse_event\(0x0004/);
  assert.match(body,/inspect the screen to verify the application result/);
  assert.doesNotMatch(body,/\.arg\("-Command"\).*proposal/);
});
test("coordinate delivery alone is not an accepted Premiere edit",()=>{
  assert.match(rust,/A dispatched drag does not prove a Timeline or Effect change/);
  assert.match(rust,/inspect_screen again to verify application outcome/);
});

test("remote edit cannot finish immediately after an unreviewed pointer drag",()=>{
  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  assert.match(main,/const needsDragReview = orchestration.last_tool === "pointer_drag"/);
  assert.match(main,/await saveActiveCheckpoint\(\)/);
  assert.match(main,/!needsDragReview &&/);
  assert.match(main,/visual result has not been verified/);
});
