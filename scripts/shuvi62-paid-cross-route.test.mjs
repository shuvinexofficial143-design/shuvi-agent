import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("BUG-029: all single-request Vision/Creative task routes reach shared Rust quota+ledger before provider dispatch",()=>{
 const fn=rust.slice(rust.indexOf("fn native_single_metered_action("),rust.indexOf("fn audit_safe_action_detail("));
 for(const arm of ["InspectScreen","MotionGraphicsGeneratePlan","MotionGraphicsGenerateCorrection",
   "MotionGraphicsReviewPreview","MotionGraphicsReviewRemotionFrames","PremiereInspectFrame",
   "PremiereReviewFrames"]){
   assert.ok(fn.includes("ToolAction::"+arm+"{"),arm);
 }
 for(const multi of ["PremiereReviewSessionNext","PremiereFinishMediaBatch"]){
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
 const audit=decide.indexOf("// P0-A: global audit tail");
 assert.ok(receipt>=0&&counter>receipt&&audit>counter);
 assert.match(decide,/entry\.taskId===taskId&&entry\.requestId===current\.action\.id/);
 assert.match(decide,/entry\.index===index/);
 assert.match(decide,/paid_action_ledger_mismatch/);
 assert.match(ui,/Multi-call paid loops remain blocked until per-request metering/);
});

test("BUG-029: bundled Remotion preview review is one quota debit for one provider call",()=>{
 const fn=rust.slice(rust.indexOf("fn native_single_metered_action("),rust.indexOf("fn audit_safe_action_detail("));
 assert.match(fn,/MotionGraphicsReviewRemotionFrames\{request,frames,provider,\.\.\}/);
 assert.match(fn,/multi_frame_prompt\(&request\.plan,&times\)\?/);
 assert.match(fn,/multi_frame_system_prompt\(\)\.len\(\)/);
 const exec=rust.slice(rust.indexOf("async fn execute_tool_with_action_id("),rust.indexOf("async fn execute_action("));
 const review=exec.slice(exec.indexOf("ToolAction::MotionGraphicsReviewRemotionFrames {request,accepted,frames,provider} =>"));
 const finish=review.indexOf("ToolAction::MotionGraphicsGeneratePlan");
 const block=finish>=0?review.slice(0,finish):review.slice(0,2500);
 assert.equal((block.match(/analyze_png_frames_with_provider\(/g)||[]).length,1);
 const before=fn.indexOf("ToolAction::MotionGraphicsReviewRemotionFrames");
 const after=fn.indexOf("ToolAction::PremiereReviewFrames",before);
 assert.ok(before>=0&&after>before);
 assert.match(ui,/"motion_graphics_review_remotion_frames"/);
});
test("BUG-029: Premiere review supports ONE paid frame, not a silent N-frame budget bypass",()=>{
 const fn=rust.slice(rust.indexOf("fn native_single_metered_action("),rust.indexOf("fn audit_safe_action_detail("));
 assert.match(fn,/ToolAction::PremiereReviewFrames\{seconds,prompt,provider\}/);
 assert.match(fn,/if seconds\.len\(\)!=1/);
 assert.match(fn,/per-call durable metering; no provider request sent/);
 assert.match(ui,/"premiere_review_frames"/);
 assert.match(fn,/ToolAction::PremiereReviewSessionNext\{\.\.\}/);
});

test("BUG-029: missing or mismatched Rust recovery never downgrades task-linked paid action to free manual provider call",()=>{
 const src=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_powershell("));
 assert.match(src,/let metered=native_single_metered_action\(&prepared\.action\)\?/);
 assert.match(src,/if let Some\(\(provider,model,bytes\)\)=metered/);
 assert.match(src,/prepared\.task_step_id\.is_some\(\)\|\|/);
 assert.match(src,/prepared\.task_graph\.is_some\(\)\|\|task_id\.is_some\(\)/);
 assert.match(src,/task_id\.as_deref\(\)\.is_some_and\(\|passed\|passed!=task\)/);
 assert.match(src,/Native task AI recovery does not match prepared task\/action; paid request refused/);
 assert.ok(src.indexOf("let metered=native_single_metered_action")<
    src.indexOf("native_worker_job::begin(&app,&action_id"));
 assert.ok(src.indexOf("Native task AI recovery does not match prepared task/action")<
    src.indexOf("execute_tool_with_action_id("));
});
