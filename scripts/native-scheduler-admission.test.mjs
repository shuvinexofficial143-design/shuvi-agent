import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessMasterSchedulerAdmission as admit} from "../src/native-scheduler-admission.mjs";
const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const step=(id="a",deps=[])=>({step_id:id,expected_tool:"blender_run_plan",depends_on:deps,
 status:"ready",evidence:[],running:null});
const graph=(jobs=[step()],objective="Edit",rev=1)=>({objective,revision:rev,steps:jobs});
const job=(phase="queued",id="a",actionId=null,deps=[])=>({
 stepId:id,tool:"blender_run_plan",dependsOn:deps,phase,actionId});
const schedule=(jobs=[job()],objective="Edit",rev=1)=>({version:1,objective,revision:rev,jobs});
const attested=(uuid=A)=>({...step(),status:"completed",evidence:[{
 action_id:uuid,tool:"blender_run_plan",audit_event:"executed",
 source:"typed_result",success:true}]});
const failed=(uuid=A)=>({...step(),status:"failed",evidence:[{
 action_id:uuid,tool:"blender_run_plan",audit_event:"failed",
 source:"local_failure",success:false}]});
test("first task may plan without a scheduler; forged progress cannot start a paid continuation",()=>{
 assert.equal(admit(null,graph()).ok,true);
 assert.equal(admit(null,graph([attested()])).ok,false);
 assert.equal(admit(undefined,graph()).ok,false);
 assert.equal(admit(undefined,null).ok,true);
 assert.equal(admit(schedule(),graph()).ok,true);
});
test("matching Rust terminal action and WebView typed receipt permit next approved step",()=>{
 assert.equal(admit(schedule([job("audited","a",A)]),graph([attested()])).ok,true);
 assert.equal(admit(schedule([job("failed","a",A)]),graph([failed()])).ok,true);
 assert.equal(admit(schedule([job("reviewed_failed","a",A)]),graph([failed()])).ok,true);
 assert.equal(admit(schedule([job("audited","a",A)]),graph([attested(B)])).ok,false);
 assert.equal(admit(schedule([job("audited","a",A)]),graph()).ok,false);
 assert.equal(admit(schedule([job("queued","a",null)]),graph([attested()])).ok,false);
});
test("outcome unknown, running, mismatch and arbitrary revisions prevent re-execution",()=>{
 assert.equal(admit(schedule([job("running","a",A)]),graph()).ok,false);
 assert.equal(admit(schedule([job("outcome_unknown","a",A)]),graph()).ok,false);
 assert.equal(admit(schedule(),graph([{...step(),status:"running",running:{action_id:A}}])).ok,false);
 assert.equal(admit(schedule([job("audited","a",A)]),graph([attested()],"Other")).ok,false);
 assert.equal(admit(schedule([job("audited","a",A)]),graph([attested()],"Edit",4)).ok,false);
 assert.equal(admit(schedule([job("audited","a",A)]),graph([attested(),step("b")],"Edit",2)).ok,true);
 assert.equal(admit(schedule([job("audited","a",A)]),graph([attested()].map(x=>({...x,expected_tool:"read_file"})))).ok,false);
 assert.equal(admit(schedule([job("audited","a",A)]),graph([attested(),attested()])).ok,false);
});
test("new approved task can replace fully terminal previous task but not running one",()=>{
 assert.equal(admit(schedule([job("audited","a",A)],"Old"),graph([step("new")],"New")).ok,true);
 assert.equal(admit(schedule([job("running","a",A)],"Old"),graph([step("new")],"New")).ok,false);
});
test("Master reads Rust scheduler before provider reservation",()=>{
 const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=main.indexOf("async function runAgentStep");
 const scheduler=main.indexOf('await invoke("native_scheduler_status")',start);
 const reserve=main.indexOf("reserveTaskModelRequest(orchestration)",start);
 assert.ok(start>=0&&scheduler>start&&reserve>scheduler);
 assert.match(main.slice(scheduler,reserve),/assessMasterSchedulerAdmission/);
 assert.match(main.slice(scheduler,reserve),/stopAgentForSafety/);
});
