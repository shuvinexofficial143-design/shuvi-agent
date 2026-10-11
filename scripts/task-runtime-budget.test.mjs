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
 assert.match(main,/createAgentOrchestrationState\(allowedTaskBudget\(selectedActions\) \? selectedActions : 8\)/);
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
 assert.match(graph,/count > MAX_RUNTIME_ACTIONS/);
 assert.match(graph,/export const GRAPH_LIMIT = 8/); // planning graph remains bounded
 assert.deepEqual(restoreTaskGraph(null,17),{ok:true,graph:null,interrupted:[]});
});
