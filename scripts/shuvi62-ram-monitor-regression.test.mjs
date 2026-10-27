import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const code=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
function block(start,end){const i=code.indexOf(start); const j=code.indexOf(end,i);assert.ok(i>0&&j>i,start);return code.slice(i,j);}
const cases=[
 ["Remotion", "let hard_limit_triggered=AtomicBool::new(false);","let accepted=motion_graphics_remotion::verify("],
 ["Project validation","ToolAction::RunProjectTask { path, task }","ToolAction::GitStatus { path }"],
 ["Manual shell", "Manual Permission Lab shells", "fn list_providers()"]
];
test("BUG-018: Remotion fails closed on identity or RAM sampler loss before artifact verification",()=>{
 const src=block("let hard_limit_triggered=AtomicBool::new(false);","let accepted=motion_graphics_remotion::verify(");
 assert.match(src,/monitor_failed\.store\(true,Ordering::Release\)/);
 assert.match(src,/let stopped=terminate_registered_process_tree\(state,child_pid\)\.unwrap_or\(false\)/);
 assert.match(src,/if timed_out\|\|over_ram\|\|lost_supervision/);
 assert.ok(src.indexOf("if timed_out||over_ram||lost_supervision")<src.length);
 assert.doesNotMatch(src,/while managed_process_identity_matches\(state,child_pid\)\.unwrap_or\(false\)/);
});
test("BUG-018: Project validation and manual shell never report success on lost supervision",()=>{
 const proj=block("ToolAction::RunProjectTask { path, task }","ToolAction::GitStatus { path }");
 assert.match(proj,/let mut success = output\.status\.success\(\) && !exceeded_hard_limit && !lost_supervision/);
 assert.match(proj,/Project task RAM\/identity supervision failed/);
 const shell=code.slice(code.indexOf("Manual Permission Lab shells are allowed"),code.indexOf("fn list_providers()"));
 assert.match(shell,/!exceeded_hard_limit && !lost_supervision/);
 assert.match(shell,/Manual shell supervision failed/);
 for(const src of [proj,shell])assert.match(src,/monitor_terminated\.load\(Ordering::Acquire\)/);
});
test("BUG-027: every screenshot mode rejects redirected folder before pruning or capture",()=>{
 const src=block("fn capture_screen_png_with_mode(ephemeral: bool)","async fn preflight_inspect_screen_vision(");
 const check=src.indexOf("target_window_capture::validate_vision_capture_directory(&dir)?;");
 const pruning=src.indexOf("prune_screenshot_dir(&dir,");
 const output=src.indexOf("let output = match run_hidden_powershell(");
 assert.ok(check>=0&&check<pruning&&pruning<output);
 assert.match(src,/Screenshot directory changed during capture/);
});
