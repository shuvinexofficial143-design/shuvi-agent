import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("BUG-029: all single-request Vision/Creative task routes reach shared Rust quota+ledger before provider dispatch",()=>{
 const fn=rust.slice(rust.indexOf("fn native_single_metered_action("),rust.indexOf("fn audit_safe_action_detail("));
 for(const arm of ["InspectScreen","MotionGraphicsGeneratePlan","MotionGraphicsGenerateCorrection",
   "MotionGraphicsReviewPreview","PremiereInspectFrame"]){
   assert.ok(fn.includes("ToolAction::"+arm+"{"),arm);
 }
 for(const multi of ["PremiereReviewFrames","PremiereReviewSessionNext",
   "MotionGraphicsReviewRemotionFrames","PremiereFinishMediaBatch"]){
   assert.ok(fn.includes("ToolAction::"+multi+"{"),multi);
 }
 assert.match(fn,/per-call durable metering/);
 const execute=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_powershell("));
 const quota=execute.indexOf("quotas.reserve_context(task,index,bytes,now_ms())?");
 const reserve=execute.indexOf("native_task_ai_ledger::reserve(&app,task,&action_id,index,provider,model)?");
 const begin=execute.indexOf("native_worker_job::begin(&app,&action_id");
 const provider=execute.indexOf("execute_tool_with_action_id(",begin);
 assert.ok(quota>0&&reserve>quota&&begin>reserve&&provider>begin);
 assert.ok(execute.indexOf("native_task_ai_ledger::complete(&app,&action_id,None")>provider);
 assert.match(execute,/record\.phase=="executing"/);
 assert.match(execute,/record\.action_id\.as_deref\(\)==Some\(action_id\.as_str\(\)\)/);
});
test("BUG-029: renderer must reconcile exact ledger action charge before audit_verified recovery",()=>{
 const decide=ui.slice(ui.indexOf("async function decide("),ui.indexOf("approve.addEventListener("));
 const receipt=decide.indexOf("native_task_ai_usage");
 const counter=decide.indexOf("reserveNativeModelRequest(meteredBudget)");
 const audit=decide.indexOf("// Native Result is not self-attested success");
 assert.ok(receipt>=0&&counter>receipt&&audit>counter);
 assert.match(decide,/entry\.taskId===taskId&&entry\.requestId===current\.action\.id/);
 assert.match(decide,/entry\.index===index/);
 assert.match(decide,/paid_action_ledger_mismatch/);
 assert.match(ui,/Multi-frame\/looping paid tools refuse task execution until separately metered/);
});
