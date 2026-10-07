import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(new URL("../src/agent-orchestrator.ts", import.meta.url), "utf8");
const executable = stripTypeScriptTypes(source).replace(
  '"./task-graph.mjs"',
  JSON.stringify(new URL("../src/task-graph.mjs", import.meta.url).href)
);
const agent = await import("data:text/javascript;base64," + Buffer.from(executable).toString("base64"));

function result(tool) {
  return { success: true, tool, stdout: "ok", stderr: "", exit_code: 0 };
}

function recordSuccess(state, proposal) {
  const decision = agent.evaluateProposal(state, proposal);
  assert.equal(decision.allowed, true, decision.reason);
  return agent.recordToolOutcome(state, proposal, "success", result(proposal.tool));
}

test("inspection calls no longer consume the execution-action budget", () => {
  let state = agent.createAgentOrchestrationState();
  for (let i = 0; i < agent.MAX_AGENT_INSPECTION_STEPS; i++) {
    state = recordSuccess(state, { tool: "ui_find", arguments: { name: "item-" + i } });
  }

  assert.equal(state.inspection_actions, 12);
  assert.equal(state.tool_actions, 0);
  assert.equal(state.next_step, 13);

  const extraInspection = agent.evaluateProposal(state, {
    tool: "premiere_context",
    arguments: {}
  });
  assert.equal(extraInspection.allowed, false);
  assert.equal(extraInspection.stop, false);
  assert.match(extraInspection.reason, /inspection budget/i);

  const action = agent.evaluateProposal(state, {
    tool: "ui_click",
    arguments: { name: "New Project" }
  });
  assert.equal(action.allowed, true);
});

test("execution actions keep an independent bounded safety ceiling", () => {
  let state = agent.createAgentOrchestrationState();
  for (let i = 0; i < agent.MAX_AGENT_ACTION_STEPS; i++) {
    state = recordSuccess(state, { tool: "ui_click", arguments: { name: "button-" + i } });
  }

  assert.equal(state.tool_actions, 12);
  assert.equal(state.inspection_actions, 0);
  assert.equal(state.next_step, 13);

  const decision = agent.evaluateProposal(state, {
    tool: "ui_click",
    arguments: { name: "one-too-many" }
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.stop, true);
  assert.match(decision.reason, /12-action execution safety limit/);
});

test("combined budgets retain a hard total orchestration ceiling", () => {
  let state = agent.createAgentOrchestrationState();
  for (let i = 0; i < agent.MAX_AGENT_INSPECTION_STEPS; i++) {
    state = recordSuccess(state, { tool: "ui_find", arguments: { name: "inspect-" + i } });
  }
  for (let i = 0; i < agent.MAX_AGENT_ACTION_STEPS; i++) {
    state = recordSuccess(state, { tool: "ui_click", arguments: { name: "act-" + i } });
  }

  assert.equal(state.next_step, 25);
  const decision = agent.evaluateProposal(state, {
    tool: "premiere_context",
    arguments: {}
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.stop, true);
  assert.match(decision.reason, /24-step total safety limit/);
});

test("v5 checkpoints migrate conservatively to v6 without inventing inspection credit", () => {
  const state = agent.normalizeAgentOrchestrationState({
    version: 5,
    next_step: 6,
    tool_actions: 5,
    consecutive_failures: 0,
    blocked_repeats: 0,
    unsuccessful_fingerprints: []
  });
  assert.equal(state.version, 6);
  assert.equal(state.tool_actions, 5);
  assert.equal(state.inspection_actions, 0);
  assert.equal(state.next_step, 6);
});

test("task-graph evidence remains resumable after more than eight inspection steps", () => {
  let state = agent.createAgentOrchestrationState();
  for (let i = 0; i < 12; i++) {
    state = recordSuccess(state, { tool: "ui_find", arguments: { name: "preflight-" + i } });
  }

  const graph = {
    objective: "Open the Premiere project",
    revision: 1,
    steps: [{
      step_id: "open",
      title: "Open project",
      purpose: "Perform the verified UI action",
      success_criteria: "The click succeeds",
      expected_tool: "ui_click",
      depends_on: []
    }]
  };
  const proposal = {
    tool: "ui_click",
    arguments: { name: "New Project" },
    task_graph: graph,
    task_step_id: "open"
  };

  assert.equal(agent.evaluateProposal(state, proposal).allowed, true);
  state = agent.acceptProposalGraph(state, proposal).state;
  state = agent.recordProposalStart(state, proposal);
  const actionId = "00000000-0000-4000-8000-000000000013";
  const bound = agent.bindPreparedAction(state, proposal, actionId);
  assert.equal(bound.ok, true);
  state = bound.state;
  state = agent.recordToolOutcome(
    state,
    proposal,
    "success",
    result("ui_click"),
    true,
    actionId,
    { action_id: actionId, event: "executed", tool: "ui_click", success: true }
  );

  assert.equal(state.task_graph.steps[0].evidence[0].orchestration_step, 13);
  const restored = agent.normalizeAgentOrchestrationState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.recovery_mode, "normal");
  assert.equal(restored.task_graph.steps[0].status, "completed");
  assert.equal(restored.next_step, 14);
});
