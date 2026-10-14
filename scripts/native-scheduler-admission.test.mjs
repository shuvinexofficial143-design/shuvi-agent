import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessMasterSchedulerAdmission as admit} from "../src/native-scheduler-admission.mjs";
const graph={objective:"Edit",steps:[{step_id:"a",expected_tool:"blender_run_plan"}]};
const job=phase=>({stepId:"a",tool:"blender_run_plan",dependsOn:[],phase,actionId:null});
const schedule=phase=>({version:1,objective:"Edit",revision:1,jobs:[job(phase)]});
test("Native scheduler allows initial, queued and verified/replan Master turns",()=>{
 for(const phase of ["queued","audited","failed","outcome_unknown"])
   assert.equal(admit(schedule(phase),graph).ok,true);
 assert.equal(admit(null,graph).ok,true);
 assert.equal(admit(undefined,null).ok,true);
});
test("Rust in-flight or missing state blocks another billable autonomous turn",()=>{
 assert.equal(admit(schedule("running"),graph).ok,false);
 assert.equal(admit(undefined,graph).ok,false);
 assert.equal(admit(schedule("invented"),graph).ok,false);
 assert.equal(admit({version:1,objective:"Edit",jobs:[job("audited"),job("running")]},graph).ok,false);
});
test("Master checks durable Rust status before reserving paid provider request",()=>{
 const source=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=source.indexOf("async function runAgentStep");
 const scheduler=source.indexOf('await invoke("native_scheduler_status")',start);
 const reserve=source.indexOf("reserveTaskModelRequest(orchestration)",start);
 assert.ok(start>=0&&scheduler>start&&reserve>scheduler);
 assert.match(source.slice(scheduler,reserve),/assessMasterSchedulerAdmission/);
 assert.match(source.slice(scheduler,reserve),/stopAgentForSafety/);
});
