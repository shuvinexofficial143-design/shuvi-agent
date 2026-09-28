import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const orchestrator=readFileSync(new URL("../src/agent-orchestrator.ts",import.meta.url),"utf8");
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const types=readFileSync(new URL("../src/types.ts",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("agent orchestration has bounded failure and repeat circuit breakers",()=>{
  assert.match(orchestrator,/MAX_AGENT_STEPS = 8/);
  assert.match(orchestrator,/MAX_CONSECUTIVE_FAILURES = 3/);
  assert.match(orchestrator,/MAX_ORCHESTRATION_BLOCKS = 2/);
  assert.match(orchestrator,/priorFailed && state\.last_proposal_fingerprint === fingerprint/);
  assert.match(orchestrator,/exact same unsuccessful action cannot be retried blindly/i);
  assert.match(orchestrator,/failures >= MAX_CONSECUTIVE_FAILURES/);
  assert.match(orchestrator,/recovery_mode: stopped \? "stopped" : replan \? "replan_required" : "normal"/);
});

test("interrupted tasks resume their persisted orchestration step instead of step one",()=>{
  assert.match(types,/orchestration\?: AgentOrchestrationCheckpoint \| null/);
  assert.match(main,/version: 2,[\s\S]*messages,[\s\S]*orchestration/);
  assert.match(main,/orchestration = normalizeAgentOrchestrationState\(checkpoint\.orchestration\)/);
  assert.doesNotMatch(main,/resumeTask[\s\S]{0,1800}runAgentStep\(1\)/);
  assert.match(main,/orchestration_context: orchestrationContext\(orchestration\)/);
});

test("new user instruction starts fresh state but failures do not auto retry",()=>{
  assert.match(main,/orchestration = createAgentOrchestrationState\(\);[\s\S]{0,500}messages\.push\(\{ role: "user", content \}\)/);
  assert.match(main,/evaluateProposal\(orchestration, proposal\)/);
  assert.match(main,/recordProposalBlock\(orchestration, proposal, decision\)/);
  assert.match(main,/orchestration_blocked: true/);
  assert.match(main,/retry_automatically: false/);
  assert.match(main,/recordToolOutcome\([\s\S]{0,200}result\.success \? "success" : "failure"/);
});

test("structured plan metadata is bounded and optional",()=>{
  assert.match(types,/export type AgentPlanMeta/);
  assert.match(types,/success_criteria: string/);
  assert.match(rust,/struct AgentPlanMeta/);
  assert.match(rust,/proposal\.plan=None/);
  assert.match(rust,/bounded\(&plan\.objective,500\)/);
  assert.match(rust,/bounded\(&plan\.success_criteria,800\)/);
  assert.match(rust,/orchestration context exceeds the 3000-character safety limit/i);
});

test("session checkpoint v1 migrates to v2 without inventing orchestration state",()=>{
  assert.match(rust,/checkpoint\.version = 2/);
  assert.match(rust,/matches!\(checkpoint\.version,1\|2\)/);
  assert.match(rust,/checkpoint\.version=2;[\s\S]*checkpoint\.orchestration=None/);
});

test("permission gates remain between planning and execution",()=>{
  assert.match(main,/pendingAction = await invoke<PendingAction>\("prepare_tool"/);
  assert.match(main,/pendingAction\.risk === "low"[\s\S]*sessionAllowedScopes/);
  assert.match(main,/renderChatPermission\(proposal, step\)/);
  assert.match(main,/await invoke<ActionResult>\("execute_action", \{ actionId \}\)/);
});

test("orchestration safety decisions are locally audited without bypassing permissions",()=>{
  assert.match(rust,/fn record_agent_event\(/);
  assert.match(rust,/"orchestration_blocked"\|"orchestration_stopped"\|"orchestration_replan"/);
  assert.match(rust,/record_agent_event,[\s\S]*set_workspace/);
  assert.match(main,/recordOrchestrationAudit\("orchestration_blocked", decision\.reason, proposal\.tool\)/);
  assert.match(main,/recordOrchestrationAudit\("orchestration_stopped", reason, orchestration\.last_tool\)/);
  assert.match(main,/Audit logging is best-effort and must not change orchestration decisions/);
});
