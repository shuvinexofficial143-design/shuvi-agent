import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {allowedTaskBudget,taskDeadline,taskDeadlineAllows,MAX_RUNTIME_ACTIONS,MAX_TASK_DURATION_MS} from "../src/task-runtime-budget.mjs";
import {restoreTaskGraph} from "../src/task-graph.mjs";

const orchestrator=readFileSync(new URL("../src/agent-orchestrator.ts",import.meta.url),"utf8");
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const types=readFileSync(new URL("../src/types.ts",import.meta.url),"utf8");

test("owner action budgets are a narrow explicit allowlist",()=>{
 assert.equal(MAX_RUNTIME_ACTIONS,48);
 for(const x of [8,24,48]) assert.equal(allowedTaskBudget(x),true);
 for(const x of [undefined,null,0,9,49,1000,"48",NaN,1.5]) assert.equal(allowedTaskBudget(x),false);
 assert.match(main,/id="taskActionBudget"/);
 assert.match(main,/createAgentOrchestrationState\(allowedTaskBudget\(selectedActions\) \? selectedActions : 8, Date\.now\(\), content\)/);
 assert.match(orchestrator,/max_steps: allowedTaskBudget\(ownerBudget\) \? ownerBudget : MAX_AGENT_STEPS/);
});

test("task deadlines expire and cannot silently extend on resume",()=>{
 const now=1_000_000;
 const expiry=taskDeadline(now);
 assert.equal(expiry,now+MAX_TASK_DURATION_MS);
 assert.equal(taskDeadlineAllows(expiry,now),true);
 assert.equal(taskDeadlineAllows(expiry,expiry),false);
 assert.equal(taskDeadlineAllows(expiry,now-1),false);
 assert.equal(taskDeadlineAllows(expiry+1,now),false);
 assert.equal(taskDeadlineAllows(null,now),true); // old <=8 legacy contracts only
 assert.match(orchestrator,/maxSteps === MAX_AGENT_STEPS \|\| deadline !== null/);
 assert.match(orchestrator,/taskDeadlineAllows\(deadline\)/);
 assert.match(orchestrator,/taskDeadlineAllows\(state.task_expires_at_ms\)/);
 assert.match(main,/!taskDeadlineAllows\(orchestration.task_expires_at_ms\)/);
});

test("restored owner contract remains bounded; steps and paid requests are gated",()=>{
 assert.match(types,/max_steps\?: number/);
 assert.match(types,/task_expires_at_ms\?: number \| null/);
 assert.match(orchestrator,/requestedNextStep > maxSteps \+ 1/);
 assert.match(orchestrator,/toolActions > maxSteps/);
 assert.match(orchestrator,/state.next_step > state.max_steps/);
 assert.match(orchestrator,/Math.min\(state.max_steps \+ 1, state.next_step \+ 1\)/);
 assert.match(main,/Owner-approved task budget expired before execution/);
 assert.match(main,/orchestration.next_step > orchestration.max_steps \|\|/);
});

test("graph restore continues validating typed evidence above legacy step eight",()=>{
 const graph=readFileSync(new URL("../src/task-graph.mjs",import.meta.url),"utf8");
 assert.match(graph,/integer\(e.orchestration_step, 1, MAX_RUNTIME_ACTIONS\)/);
 assert.match(graph,/nextStep > MAX_RUNTIME_ACTIONS/);
 assert.match(graph,/count > maxSteps/);
 assert.match(graph,/export const GRAPH_LIMIT = 8/); // planning graph remains bounded
 assert.deepEqual(restoreTaskGraph(null,17),{ok:true,graph:null,interrupted:[]});
});


test("model-call reservations are finite, counted before dispatch and never silently reset",async()=>{
 const {reserveTaskModelRequest,maxTaskModelRequests}=await import("../src/task-runtime-budget.mjs");
 assert.equal(maxTaskModelRequests(8),9);
 assert.equal(maxTaskModelRequests(24),25);
 assert.equal(maxTaskModelRequests(48),49);
 assert.equal(maxTaskModelRequests(1000),null);
 let s={max_steps:8,model_requests_reserved:0,task_expires_at_ms:Date.now()+10000};
 for(let n=1;n<=9;n++){
   const reservation=reserveTaskModelRequest(s);
   assert.equal(reservation.ok,true);
   s=reservation.state;
   assert.equal(s.model_requests_reserved,n);
 }
 assert.equal(reserveTaskModelRequest(s).ok,false);
 assert.match(reserveTaskModelRequest(s).reason,/budget exhausted/);
 for(const x of [undefined,null,-1,1.5,50,"4"]){
   assert.equal(reserveTaskModelRequest({...s,model_requests_reserved:x}).ok,false);
 }
 assert.equal(reserveTaskModelRequest({...s,max_steps:24,model_requests_reserved:24}).ok,true);
 assert.equal(reserveTaskModelRequest({...s,max_steps:24,model_requests_reserved:26}).ok,false);
 assert.equal(reserveTaskModelRequest({...s,max_steps:8,model_requests_reserved:0,task_expires_at_ms:Date.now()-1000}).ok,false);
});

test("runtime persists the model request BEFORE a paid chat and validates restored counts",()=>{
 const reserve=main.indexOf("const reservation = reserveTaskModelRequest(orchestration)");
 const persist=main.indexOf('await invoke("save_session_checkpoint", { checkpoint: currentCheckpoint() });',reserve);
 const dispatch=main.indexOf('const response = await invoke<ChatResponse>("chat", {',persist);
 assert.ok(reserve>=0 && persist>reserve && dispatch>persist);
 assert.match(main.slice(reserve,dispatch),/orchestration = reservation.state/);
 assert.match(main.slice(reserve,dispatch),/No AI provider request was sent/);
 assert.match(orchestrator,/model_requests_reserved: 0/);
 assert.match(orchestrator,/!validRequests/);
 assert.match(orchestrator,/missingRequests && maxSteps === MAX_AGENT_STEPS/);
 assert.match(orchestrator,/paid AI model requests reserved:/);
});


test("extended graph wiring respects owner budget, preserves audit evidence and legacy graph limits",()=>{
 const graph=readFileSync(new URL("../src/task-graph.mjs",import.meta.url),"utf8");
 assert.match(orchestrator,/restoreTaskGraph\(input.version === 5 \? input.task_graph : null, nextStep, maxSteps\)/);
 assert.match(orchestrator,/state.recovery_step, state.max_steps\)/);
 assert.match(graph,/parseTaskGraph\(metadata, maxSteps\)/);
 assert.match(graph,/count > maxSteps/);
 assert.match(graph,/evidence: \[\.\.\.s.evidence, evidence\]\.slice\(-MAX_RUNTIME_ACTIONS\)/);
});
