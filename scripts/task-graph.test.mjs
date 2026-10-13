import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as graph from "../src/task-graph.mjs";

// Execute the real TS coordinator, not a reimplementation or regex-only model.
const source = readFileSync(new URL("../src/agent-orchestrator.ts", import.meta.url), "utf8");
const executable = stripTypeScriptTypes(source).replace('"./task-graph.mjs"',
  JSON.stringify(new URL("../src/task-graph.mjs", import.meta.url).href)).replace('"./task-runtime-budget.mjs"',
  JSON.stringify(new URL("../src/task-runtime-budget.mjs",import.meta.url).href));
const agent = await import("data:text/javascript;base64," + Buffer.from(executable).toString("base64"));

function step(step_id, depends_on = [], expected_tool = "read_file") {
  return { step_id, title: step_id, purpose: "Inspect the requested target",
    success_criteria: "Expected typed tool succeeds", depends_on, expected_tool };
}
function plan(steps = [step("inspect"), step("edit", ["inspect"], "replace_text")], revision = 1) {
  return { objective: "Fix the bug", revision, steps };
}
function proposal(task_step_id = "inspect", tool = "read_file", extra = {}) {
  return { tool, arguments: { path: tool==="premiere_insert_media"?"/repo/remotion.mp4":"/repo/a.ts" }, task_step_id, ...extra };
}
function result(tool = "read_file", success = true, exit_code = 0) {
  return { tool, success, exit_code, stdout: "observed", stderr: "" };
}
function actionIdFor(stepNumber) {
  return `00000000-0000-4000-8000-${String(stepNumber).padStart(12,"0")}`;
}
function auditReceipt(action_id, tool, success = true, event = "executed") {
  return { timestamp_ms: 1, event, tool, detail: "receipt", success, action_id };
}
function staged(state, p) {
  assert.equal(agent.evaluateProposal(state, p).allowed, true);
  state = agent.acceptProposalGraph(state, p).state;
  state = agent.recordProposalStart(state, p);
  if (p.task_step_id != null) {
    const bound = agent.bindPreparedAction(state, p, actionIdFor(state.next_step));
    assert.equal(bound.ok, true);
    state = bound.state;
  }
  return state;
}
function runningActionId(state, p) {
  return state.task_graph?.steps.find(x => x.step_id === p.task_step_id)?.running?.action_id ?? null;
}
function done(state, p, r = result(p.tool)) {
  state = staged(state, p);
  const actionId = runningActionId(state, p);
  if(r.stdout==="observed"&&p.tool==="blender_run_plan"){
    r={...r,stdout:JSON.stringify({status:"verified",worker:"blender",
      full_plan_completed:true,verified_by_native_sha256:true,
      artifact:{path:"/repo/blender.png",sha256:"b".repeat(64),bytes:8192}})};
  }
  if(r.stdout==="observed"&&p.tool==="motion_graphics_accept_final_remotion"){
    const render=state.task_graph.steps.find(s=>s.expected_tool==="motion_graphics_run_remotion")?.evidence.find(e=>e.success);
    r={...r,stdout:JSON.stringify({
      schema_version:1,acceptance_action_id:actionId,render_action_id:render?.action_id,
      output_file:"/repo/remotion.mp4",output_sha256:"a".repeat(64),
      final_output_sha256_verified:true,visual_review_verified:true,
      runtime_process_provenance_verified:true,delivery_acceptance_verified:true,
      dependency_source_integrity_verified:false,production_ready:false
    })};
  }
  if(r.stdout==="observed"&&p.tool==="motion_graphics_plan_premiere_insertion"){
    const accept=state.task_graph.steps.find(s=>s.expected_tool==="motion_graphics_accept_final_remotion")
      ?.evidence.find(e=>e.success);
    r={...r,stdout:JSON.stringify({
      schema_version:1,source:"verified_motion_graphics_delivery",
      final_acceptance_action_id:accept?.action_id,
      output_file:accept?.artifact?.path,output_sha256:accept?.artifact?.sha256,
      premiere_tool_proposal:{tool:"premiere_insert_media",arguments:{path:accept?.artifact?.path}},
      automatic_execution:false,requires_normal_premiere_approval:true,production_ready:false
    })};
  }
  return agent.recordToolOutcome(
    state,
    p,
    r.success ? "success" : "failure",
    r,
    true,
    actionId,
    actionId ? auditReceipt(actionId, r.tool, r.success, "executed") : null
  );
}
function initial(p = plan()) {
  return agent.acceptProposalGraph(agent.createAgentOrchestrationState(),
    proposal(p.steps[0].step_id, p.steps[0].expected_tool, { task_graph: p })).state;
}
const json = x => JSON.parse(JSON.stringify(x));

test("valid DAG accepted with deterministic ready/pending states", () => {
  const s = initial();
  assert.deepEqual(s.task_graph.steps.map(x => x.status), ["ready", "pending"]);
  assert.equal(s.task_graph.revision, 1);
});
for (const [name, steps] of [
  ["cycle", [step("a", ["b"]), step("b", ["a"])]],
  ["duplicate ID", [step("a"), step("a")]],
  ["unknown predecessor", [step("a", ["missing"])]],
  ["self dependency", [step("a", ["a"])]],
  ["nine steps", Array.from({length:9}, (_,i) => step("s"+i))],
  ["duplicate dependency", [step("a"), step("b", ["a","a"])]],
  ["oversized title", [{...step("a"),title:"x".repeat(101)}]],
  ["oversized dependency list", [step("a",Array.from({length:8},(_,i)=>"s"+i))]],
  ["model status", [{...step("a"),status:"completed"}]],
  ["model evidence", [{...step("a"),evidence:[{success:true}]}]]
]) test("rejects " + name, () => assert.equal(graph.parseTaskGraph(plan(steps)).ok, false));

test("malformed optional graph blocks before staging without erasing an active graph", () => {
  const s = initial();
  for (const task_graph of [false, {}, [], {objective:"x",steps:"bad"}]) {
    const p = proposal("inspect", "read_file", {task_graph});
    assert.equal(agent.evaluateProposal(s,p).allowed,false);
    assert.equal(agent.acceptProposalGraph(s,p).state,s);
  }
});
test("dependency prevents premature work and names missing predecessor", () => {
  const s = initial(), p = proposal("edit", "replace_text");
  const d = agent.evaluateProposal(s,p);
  assert.equal(d.allowed,false);
  assert.match(d.reason,/inspect/);
  const blocked = agent.recordProposalBlock(s,p,d);
  assert.equal(blocked.task_graph.steps[1].status,"blocked");
  assert.equal(blocked.tool_actions,0);
});
test("only an associated running typed success completes and unlocks dependencies", () => {
  let s = initial(), p = proposal();
  const unstaged = agent.recordToolOutcome(s,p,"success",result());
  assert.equal(graph.taskGraphProgress(unstaged.task_graph).completed,0);
  s = done(s,p);
  assert.deepEqual(s.task_graph.steps.map(x=>x.status),["completed","ready"]);
  const e = s.task_graph.steps[0].evidence[0];
  assert.equal(e.tool,"read_file");
  assert.equal(e.source,"typed_result");
  assert.equal(e.fingerprint,agent.proposalFingerprint(p));
  assert.equal(e.orchestration_step,1);
  assert.equal(e.stdout,undefined);
});
test("success enum and provider prose cannot self-mark completion", () => {
  const p = proposal(), s = staged(initial(),p);
  const after = agent.recordToolOutcome(s,p,"success");
  assert.equal(graph.taskGraphProgress(after.task_graph).completed,0);
  assert.equal(after.task_graph.steps[0].status,"failed");
});
test("failed typed result does not complete or satisfy dependencies", () => {
  const s = done(initial(),proposal(),result("read_file",false,1));
  assert.equal(s.task_graph.steps[0].status,"failed");
  assert.equal(s.recovery_mode,"replan_required");
  assert.equal(agent.evaluateProposal(s,proposal("edit","replace_text")).allowed,false);
});
test("mismatched typed tool cannot become completion evidence", () => {
  const p = proposal(), s = staged(initial(),p);
  const id = runningActionId(s,p);
  const after = agent.recordToolOutcome(
    s,p,"success",result("git_status"),true,id,
    auditReceipt(id,"git_status",true,"executed")
  );
  assert.equal(graph.taskGraphProgress(after.task_graph).completed,0);
});
test("prepared action UUID is required and must match the running receipt", () => {
  const p = proposal();
  let s = initial();
  assert.equal(agent.evaluateProposal(s,p).allowed,true);
  s = agent.acceptProposalGraph(s,p).state;
  s = agent.recordProposalStart(s,p);

  const bad = agent.bindPreparedAction(s,p,"not-a-uuid");
  assert.equal(bad.ok,false);

  const id = actionIdFor(s.next_step);
  const bound = agent.bindPreparedAction(s,p,id);
  assert.equal(bound.ok,true);
  s = bound.state;
  assert.equal(runningActionId(s,p),id);

  const rebound = agent.bindPreparedAction(s,p,actionIdFor(7));
  assert.equal(rebound.ok,false);

  const wrongId = actionIdFor(6);
  const wrong = agent.recordToolOutcome(
    s,p,"success",result(),true,wrongId,
    auditReceipt(wrongId,"read_file",true,"executed")
  );
  assert.equal(wrong.task_graph.steps[0].status,"failed");
  assert.equal(graph.taskGraphProgress(wrong.task_graph).completed,0);
});

test("task completion requires exact Rust audit receipt correlation", () => {
  const p=proposal();
  let s=staged(initial(),p);
  const id=runningActionId(s,p);

  for (const receipt of [
    null,
    auditReceipt(actionIdFor(7),"read_file",true,"executed"),
    auditReceipt(id,"git_status",true,"executed"),
    auditReceipt(id,"read_file",false,"executed"),
    auditReceipt(id,"read_file",true,"denied")
  ]) {
    const after=agent.recordToolOutcome(s,p,"success",result(),false,id,receipt);
    assert.equal(after.task_graph.steps[0].status,"failed");
    assert.equal(graph.taskGraphProgress(after.task_graph).completed,0);
  }

  const ok=agent.recordToolOutcome(
    s,p,"success",result(),true,id,auditReceipt(id,"read_file",true,"executed")
  );
  assert.equal(ok.task_graph.steps[0].status,"completed");
  assert.equal(ok.task_graph.steps[0].evidence[0].audit_event,"executed");
});

test("successful evidence stores exact prepared action ID and restore rejects missing binding", () => {
  const p=proposal();
  const s=done(initial(),p);
  const e=s.task_graph.steps[0].evidence[0];
  assert.equal(e.action_id,actionIdFor(1));
  assert.equal(e.audit_event,"executed");
  assert.equal(e.success,true);

  const missingAudit=json(s);
  delete missingAudit.task_graph.steps[0].evidence[0].audit_event;
  assert.equal(agent.normalizeAgentOrchestrationState(missingAudit).recovery_mode,"stopped");

  const missing=json(s);
  delete missing.task_graph.steps[0].evidence[0].action_id;
  assert.equal(agent.normalizeAgentOrchestrationState(missing).recovery_mode,"stopped");

  const malformed=json(s);
  malformed.task_graph.steps[0].evidence[0].action_id="bad";
  assert.equal(agent.normalizeAgentOrchestrationState(malformed).recovery_mode,"stopped");
});

test("legacy v3 graph checkpoints fail closed because prepared action IDs were not bound", () => {
  const legacy=json(done(initial(),proposal()));
  legacy.version=3;
  for(const step of legacy.task_graph.steps) {
    for(const e of step.evidence) delete e.action_id;
  }
  const restored=agent.normalizeAgentOrchestrationState(legacy);
  assert.equal(restored.recovery_mode,"stopped");
  assert.match(restored.stop_reason,/predates prepared-action binding/);
});

test("legacy v4 graph checkpoints fail closed because Rust audit receipts were not correlated", () => {
  const legacy=json(done(initial(),proposal()));
  legacy.version=4;
  for(const step of legacy.task_graph.steps) {
    for(const e of step.evidence) delete e.audit_event;
  }
  const restored=agent.normalizeAgentOrchestrationState(legacy);
  assert.equal(restored.recovery_mode,"stopped");
  assert.match(restored.stop_reason,/predates Rust audit-receipt correlation/);
});

test("validation step requires run_project_task with a successful exit code", () => {
  const p = proposal("test","run_project_task");
  for (const code of [null,1]) {
    const s = done(initial(plan([step("test",[],"run_project_task")])),p,result("run_project_task",true,code));
    assert.equal(s.task_graph.steps[0].status,"failed");
  }
  const s = done(initial(plan([step("test",[],"run_project_task")])),p,result("run_project_task",true,0));
  assert.equal(s.task_graph.steps[0].status,"completed");
  assert.equal(s.coding.last_validation_step,1);
  assert.equal(agent.evaluateProposal(initial(plan([step("test",[],"run_project_task")])),proposal("test")).allowed,false);
});
test("denial remains failed and its fingerprint survives successful inspection and renaming", () => {
  const p = proposal();
  let s = staged(initial(),p);
  {
    const id=runningActionId(s,p);
    s = agent.recordToolOutcome(
      s,p,"denied",undefined,false,id,auditReceipt(id,p.tool,false,"denied")
    );
  }
  s = done(s,proposal(undefined,"git_status",{task_step_id:undefined,task_recovery:true,arguments:{path:"/repo"}}));
  const renamed = proposal("new_step","read_file",{task_graph:plan([step("inspect"),step("new_step")],2)});
  assert.equal(agent.evaluateProposal(s,renamed).allowed,false);
  assert.equal(s.unsuccessful_fingerprints.includes(agent.proposalFingerprint(p)),true);
});
test("completed evidence survives compatible replan unchanged", () => {
  let s = done(initial(),proposal());
  const evidence = json(s.task_graph.steps[0].evidence);
  const next = plan([step("inspect"),{...step("edit",["inspect"],"replace_text"),title:"Apply precise fix"}],2);
  const p = proposal("edit","replace_text",{task_graph:next,arguments:{path:"/repo/a.ts",old:"a",new:"b"}});
  s = agent.acceptProposalGraph(s,p).state;
  assert.equal(s.task_graph.revision,2);
  assert.deepEqual(s.task_graph.steps[0].evidence,evidence);
});
test("replan cannot alter objective, completed spec, evidence, or erase historical step", () => {
  const s = done(initial(),proposal());
  for (const next of [
    {...plan(undefined,2),objective:"Other goal"},
    plan([{...step("inspect"),title:"Claim another task"},step("edit",["inspect"],"replace_text")],2),
    plan([step("edit",[],"replace_text")],2),
    plan([{...step("inspect"),evidence:[]},step("edit",["inspect"],"replace_text")],2)
  ]) assert.equal(graph.reviseTaskGraph(s.task_graph,next,s.objective).ok,false);
});
test("failed step needs explicit recovery after a different successful inspection", () => {
  let s = done(initial(),proposal(),result("read_file",false,1));
  const next = {...plan(undefined,2),recover_steps:["inspect"]};
  assert.equal(graph.reviseTaskGraph(s.task_graph,next,s.objective,s.recovery_step).ok,false);
  const recovery = proposal(undefined,"git_status",{task_step_id:undefined,task_recovery:true,arguments:{path:"/repo"}});
  s = done(s,recovery);
  const change = graph.reviseTaskGraph(s.task_graph,next,s.objective,s.recovery_step);
  assert.equal(change.ok,true);
  assert.equal(change.graph.steps[0].status,"ready");
  assert.equal(change.graph.steps[0].evidence[0].success,false);
  const p = proposal("inspect","read_file",{task_graph:next,arguments:{path:"/repo/b.ts"}});
  assert.equal(agent.evaluateProposal(s,p).allowed,true);
  assert.equal(agent.evaluateProposal(s,proposal("inspect","read_file",{task_graph:next})).allowed,false);
});
test("failed history cannot be erased, and failed state remains through unrelated replan", () => {
  const s = done(initial(),proposal(),result("read_file",false,1));
  assert.equal(graph.reviseTaskGraph(s.task_graph,plan([step("other")],2),s.objective,2).ok,false);
  const revised = graph.reviseTaskGraph(s.task_graph,plan([step("inspect"),step("new")],2),s.objective);
  assert.equal(revised.ok,true);
  assert.equal(revised.graph.steps[0].status,"failed");
});
test("unassociated graph actions fail closed; recovery cannot mutate", () => {
  const s = initial();
  assert.equal(agent.evaluateProposal(s,{tool:"read_file",arguments:{path:"/a"}}).allowed,false);
  assert.equal(agent.evaluateProposal(s,{tool:"write_file",arguments:{path:"/a"},task_recovery:true}).allowed,false);
  assert.equal(agent.evaluateProposal(s,proposal("inspect","read_file",{task_recovery:"true"})).allowed,false);
});
test("completed step and same completed action under another ID cannot rerun", () => {
  const s = done(initial(),proposal());
  assert.equal(agent.evaluateProposal(s,proposal()).allowed,false);
  const next = plan([step("inspect"),step("again")],2);
  assert.equal(agent.evaluateProposal(s,proposal("again","read_file",{task_graph:next})).allowed,false);
});
test("checkpoint v5 round trip preserves action-and-audit-bound evidence and next step", () => {
  const s = done(initial(),proposal());
  const restored = agent.normalizeAgentOrchestrationState(json(s));
  assert.deepEqual(restored,s);
  assert.equal(restored.next_step,2);
  assert.equal(graph.taskGraphProgress(restored.task_graph).completed,1);
});
test("legacy v1/v2/v3/v4 non-graph migration starts with no invented graph", () => {
  for (const version of [1,2,3,4]) {
    const s = agent.normalizeAgentOrchestrationState({version,next_step:4});
    assert.equal(s.task_graph,null);
    assert.equal(s.next_step,4);
    assert.equal(s.version,5);
  }
});
test("interrupted in-flight actions become uncertain failures, never automatic retries", () => {
  const p = proposal(), s = staged(initial(),p);
  const restored = agent.normalizeAgentOrchestrationState(json(s));
  assert.equal(restored.task_graph.steps[0].status,"failed");
  assert.equal(restored.task_graph.steps[0].evidence[0].source,"interrupted");
  assert.equal(restored.next_step,2);
  assert.equal(restored.recovery_mode,"replan_required");
  assert.equal(agent.evaluateProposal(restored,p).allowed,false);
  assert.deepEqual(agent.normalizeAgentOrchestrationState(json(restored)),restored);
});
test("malformed saved completion and future/duplicate evidence fail closed", () => {
  const s = done(initial(),proposal());
  for (const mutate of [
    x=>x.task_graph.steps[0].evidence.splice(0),
    x=>x.task_graph.steps[0].evidence[0].orchestration_step=7,
    x=>x.task_graph.steps[0].evidence[0].source="provider",
    x=>x.task_graph.objective="Different goal"
  ]) {
    const bad=json(s); mutate(bad);
    assert.equal(agent.normalizeAgentOrchestrationState(bad).recovery_mode,"stopped");
  }
});
test("ready state is recomputed from actual dependency evidence on resume", () => {
  const s = initial();
  s.task_graph.steps[1].status="ready";
  const restored = agent.normalizeAgentOrchestrationState(json(s));
  assert.equal(restored.task_graph.steps[1].status,"pending");
});
test("coding hard dependencies override a permissive graph", () => {
  for (const tool of ["replace_text","apply_patch","git_commit","git_push"]) {
    const s = agent.createAgentOrchestrationState();
    const p = proposal("action",tool,{task_graph:plan([step("action",[],tool)])});
    const decision=agent.evaluateProposal(s,p);
    assert.equal(decision.allowed,false);
    assert.match(decision.reason,/Coding dependency/);
  }
});
test("successful coding sequence still enforces fresh same-repository review", () => {
  const HEAD_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const HEAD_C="cccccccccccccccccccccccccccccccccccccccc";
  const WORKTREE_A="dddddddddddddddddddddddddddddddddddddddd";
  const gitResult=(tool,head)=>({
    tool,success:true,exit_code:0,stderr:"",
    stdout:"[SHUVI_GIT_CONTEXT_V1]"+JSON.stringify({
      schema:1,repo_root:"/repo",branch:"main",head,upstream:"origin/main",
      upstream_head:HEAD_A,worktree_clean:false,worktree_fingerprint:WORKTREE_A
    })+"\nobserved"
  });
  const p=(tool,path="/repo")=>{
    const args={path};
    if(tool==="apply_patch") args.expected_worktree_fingerprint=WORKTREE_A;
    if(tool==="git_commit") Object.assign(args,{message:"x",files:["a.ts"],expected_head:HEAD_A,expected_worktree_fingerprint:WORKTREE_A});
    if(tool==="git_push") args.expected_head=HEAD_C;
    return {tool,arguments:args};
  };
  let s=agent.createAgentOrchestrationState();
  s=done(s,p("git_status"),gitResult("git_status",HEAD_A));
  s=done(s,p("apply_patch"),result("apply_patch"));
  assert.equal(agent.evaluateProposal(s,p("git_commit")).allowed,false);
  s=done(s,p("git_status"),gitResult("git_status",HEAD_A));
  s=done(s,p("git_diff"),gitResult("git_diff",HEAD_A));
  assert.equal(agent.evaluateProposal(s,p("git_commit")).allowed,true);
  s=done(s,p("git_commit"),gitResult("git_commit",HEAD_C));
  assert.equal(agent.evaluateProposal(s,p("git_push","/other")).allowed,false);
  assert.equal(agent.evaluateProposal(s,p("git_push")).allowed,true);
});
test("three consecutive actual failures stop; preparation and denial do not add real failures", () => {
  let s=agent.createAgentOrchestrationState();
  for(let i=0;i<3;i++) {
    const p={tool:"read_file",arguments:{path:"/file"+i}};
    s=done(s,p,result("read_file",false,1));
  }
  assert.equal(s.recovery_mode,"stopped");
  let prep=agent.createAgentOrchestrationState();
  prep=agent.recordToolOutcome(prep,{tool:"read_file",arguments:{}},"failure",undefined,false);
  assert.equal(prep.consecutive_failures,0);
  prep=agent.recordToolOutcome(prep,{tool:"read_file",arguments:{path:"other"}},"denied");
  assert.equal(prep.consecutive_failures,0);
});
test("replan cannot increase eight-action or eight-revision ceilings", () => {
  const s={...initial(),next_step:9};
  assert.equal(agent.evaluateProposal(s,proposal()).allowed,false);
  assert.equal(graph.parseTaskGraph(plan(undefined,9)).ok,false);
});
test("progress completion count requires typed evidence even for forged in-memory status", () => {
  const s=initial();
  s.task_graph.steps[0].status="completed";
  const progress=graph.taskGraphProgress(s.task_graph);
  assert.equal(progress.completed,0);
  assert.equal(progress.steps[0].status,"pending");
});
test("frontend correlates execution with exact Rust audit receipt before evidence update", () => {
  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  const execute=main.slice(
    main.indexOf("async function executePendingProposal"),
    main.indexOf("function renderChatPermission")
  );
  const executeCall=execute.indexOf('"execute_action"');
  const receiptCall=execute.indexOf("readActionAuditReceipt(actionId)");
  const outcomeCall=execute.indexOf("recordToolOutcome");
  assert.ok(executeCall>=0);
  assert.ok(receiptCall>executeCall);
  assert.ok(outcomeCall>receiptCall);
  assert.match(execute,/verifiedNativeActionResult\(proposal.tool, actionId, result, receipt\)/);
  assert.match(execute,/if \(!receiptMatches\) \{[\s\S]*?await stopAgentForSafety/);
  assert.match(execute,/evidence_verification_failed: true/);
  assert.match(execute,/execution_failure_audit_confirmed: cancelledByUser \? false : confirmedFailure/);
  assert.match(main,/action_audit_receipt/);
});

test("UI binds exact prepared action before approval or execution", () => {
  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  const stage=main.slice(main.indexOf("async function stageProposal"),main.indexOf("function clearChatPermission"));
  assert.ok(stage.indexOf("evaluateProposal")<stage.indexOf('"prepare_tool"'));
  assert.ok(stage.indexOf("recordProposalStart")<stage.indexOf('"save_session_checkpoint"'));
  const prepare=stage.indexOf('"prepare_tool"');
  const bind=stage.indexOf("bindPreparedAction");
  const boundSave=stage.indexOf('"save_session_checkpoint"',prepare);
  const autoExecute=stage.indexOf("executePendingProposal(proposal)",prepare);
  const permission=stage.indexOf("renderChatPermission(proposal, step)",prepare);
  assert.ok(prepare>=0 && bind>prepare);
  assert.ok(boundSave>bind);
  assert.ok(autoExecute>boundSave);
  assert.ok(permission>boundSave);
  assert.match(main,/recordToolOutcome\([\s\S]{0,520}actionId,[\s\S]{0,80}receipt/);
  assert.match(main,/deniedConfirmed \? "denied" : "failure"[\s\S]{0,260}actionId,[\s\S]{0,80}receipt/);
  assert.match(main,/taskGraphProgress\(orchestration.task_graph\)/);
  assert.match(main,/row.textContent/);
  assert.match(main,/progress.completed < progress.total/);
});
test("strict Rust event allowlist matches all graph audit events", () => {
  const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
  const section=rust.slice(rust.indexOf("fn record_agent_event("),rust.indexOf("fn set_workspace("));
  const allow=section.match(/matches!\(event.as_str\(\),([^\n]+)\)/)[1];
  const names=[...allow.matchAll(/"([a-z_]+)"/g)].map(x=>x[1]);
  assert.deepEqual(names.slice(3).sort(),[...graph.GRAPH_AUDIT_EVENTS].sort());
  assert.equal(names.length,9);
  assert.match(section,/detail.chars\(\).count\(\)>1_200/);
});

test("user stop finalizes a pending prepared graph action before resume", () => {
  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  const stopStart=main.indexOf('el<HTMLButtonElement>("#stopButton").addEventListener');
  const stop=main.slice(stopStart,main.indexOf("document.querySelectorAll<HTMLButtonElement>",stopStart));
  assert.match(main,/let pendingChatProposal: ToolProposal \| null = null/);
  assert.match(stop,/pendingAction && pendingChatProposal/);
  assert.match(stop,/const proposal = pendingChatProposal/);
  assert.ok(stop.indexOf('"deny_action"') < stop.indexOf("recordToolOutcome"));
  assert.match(stop,/denied \? "denied" : "failure"/);
  assert.match(stop,/undefined,\s+false,\s+actionId/);
  assert.ok(stop.indexOf("recordToolOutcome") < stop.indexOf("saveActiveCheckpoint"));
  assert.ok(stop.indexOf("saveActiveCheckpoint") < stop.indexOf("runAgentStep"));
});

test("stopped checkpoint cannot be revived by an interrupted receipt", () => {
  const s = staged(initial(), proposal());
  s.recovery_mode = "stopped";
  s.stop_reason = "User instruction required.";
  assert.equal(agent.normalizeAgentOrchestrationState(json(s)).recovery_mode, "stopped");
});
test("explicit recovery may reinspect a previously read target without completing another step", () => {
  const s = done(initial(), proposal());
  const recovery = proposal(undefined, "read_file", {task_step_id:undefined, task_recovery:true});
  const after = done(s,recovery);
  assert.equal(graph.taskGraphProgress(after.task_graph).completed,1);
  assert.equal(after.recovery_step,2);
});
test("legacy known denial remains blocked after a different inspection", () => {
  const p = {tool:"read_file",arguments:{path:"/denied"}};
  let s=agent.normalizeAgentOrchestrationState({version:2,next_step:2,last_outcome:"denied",
    last_proposal_fingerprint:agent.proposalFingerprint(p)});
  s=done(s,{tool:"git_status",arguments:{path:"/repo"}});
  assert.equal(agent.evaluateProposal(s,p).allowed,false);
});
test("all four-node directed graphs agree with independent topological removal", () => {
  const pairs=[];
  for(let a=0;a<4;a++) for(let b=0;b<4;b++) if(a!==b) pairs.push([a,b]);
  for(let mask=0;mask<2**pairs.length;mask++) {
    const deps=Array.from({length:4},()=>[]);
    pairs.forEach(([a,b],bit)=>{ if(mask & 2**bit) deps[a].push(b); });
    const remaining=new Set([0,1,2,3]);
    let changed=true;
    while(changed) {
      changed=false;
      for(const v of [...remaining]) if(deps[v].every(d=>!remaining.has(d))) {remaining.delete(v);changed=true;}
    }
    const input=plan(deps.map((ds,i)=>step("s"+i,ds.map(d=>"s"+d))));
    assert.equal(graph.parseTaskGraph(input).ok,remaining.size===0,"edge mask "+mask);
  }
});

test("recovery revision stages and completes through the full coordinator flow", () => {
  let s=done(initial(),proposal(),result("read_file",false,1));
  s=done(s,{tool:"git_status",arguments:{path:"/repo"},task_recovery:true});
  const p=proposal("inspect","read_file",{arguments:{path:"/repo/b.ts"},
    task_graph:{...plan(undefined,2),recover_steps:["inspect"]}});
  s=done(s,p);
  assert.equal(s.task_graph.revision,2);
  assert.equal(s.task_graph.steps[0].status,"completed");
  assert.equal(s.task_graph.steps[0].evidence.length,2);
  assert.equal(s.task_graph.steps[0].evidence[0].success,false);
  assert.equal(s.task_graph.steps[0].evidence[1].success,true);
});


test("task graph declarations expose prepared-action and audit-bound evidence", () => {
  const declarations=readFileSync(new URL("../src/task-graph.d.mts",import.meta.url),"utf8");
  assert.match(declarations,/export function bindTaskStepAction\(/);
  assert.match(declarations,/action_id: string \| null/);
  assert.match(declarations,/audit_event: "executed" \| "failed" \| "denied" \| null/);
  assert.match(declarations,/running: \{ fingerprint: string; orchestration_step: number; action_id: string \| null \}/);
  assert.match(declarations,/preparedActionId\?: string \| null/);
  assert.match(declarations,/auditReceipt\?: TaskAuditReceipt \| null/);
});


test("coding-only block preserves graph reason until explicit replan", () => {
  const s=initial(plan([step("inspect"),step("edit",[],"replace_text")]));
  const p=proposal("edit","replace_text");
  const d=agent.evaluateProposal(s,p);
  assert.equal(d.allowed,false);
  assert.match(d.reason,/Coding dependency/);
  const blocked=agent.recordProposalBlock(s,p,d);
  const current=blocked.task_graph.steps.find(x=>x.step_id==="edit");
  assert.equal(current.status,"blocked");
  assert.match(current.blocked_reason,/read the exact target file/);
  const restored=agent.normalizeAgentOrchestrationState(json(blocked));
  const resumed=restored.task_graph.steps.find(x=>x.step_id==="edit");
  assert.equal(resumed.status,"blocked");
  assert.equal(resumed.blocked_reason,current.blocked_reason);
});

test("blocked checkpoint without a bounded reason fails closed", () => {
  const s=initial();
  s.task_graph.steps[1].status="blocked";
  s.task_graph.steps[1].blocked_reason=null;
  assert.equal(agent.normalizeAgentOrchestrationState(json(s)).recovery_mode,"stopped");
});


test("progress exposes visible evidence verification and failure reasons", () => {
  let s=done(initial(),proposal());
  let progress=graph.taskGraphProgress(s.task_graph);
  assert.equal(progress.steps[0].evidence_verified,true);
  assert.equal(progress.steps[1].evidence_verified,false);

  s=done(initial(),proposal(),result("read_file",false,1));
  progress=graph.taskGraphProgress(s.task_graph);
  assert.equal(progress.steps[0].status,"failed");
  assert.match(progress.steps[0].reason,/matching typed result and Rust audit evidence/);

  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  assert.match(main,/evidence-verified steps complete/);
  assert.match(main,/verified evidence/);
  assert.match(main,/step\.reason && \(step\.status === "failed" \|\| step\.status === "blocked"\)/);
});


test("persisted action receipts cannot rewind the eight-step budget", () => {
  const state=agent.normalizeAgentOrchestrationState({
    version:5,
    next_step:2,
    tool_actions:8,
    consecutive_failures:0,
    blocked_repeats:0,
    unsuccessful_fingerprints:[]
  });
  assert.equal(state.next_step,9);
  const decision=agent.evaluateProposal(state,{tool:"read_file",arguments:{path:"/repo/a.ts"}});
  assert.equal(decision.allowed,false);
  assert.equal(decision.stop,true);
  assert.match(decision.reason,/8-step safety limit/);
});

test("persisted coding step receipts can only advance the resume floor", () => {
  const state=agent.normalizeAgentOrchestrationState({
    version:5,
    next_step:2,
    tool_actions:1,
    coding:{
      active:true,
      inspected_paths:[],
      inspection_steps:{},
      last_mutation_step:7,
      last_validation_step:0,
      last_git_status_step:0,
      last_git_status_path:null,
      last_git_diff_step:0,
      last_git_diff_path:null,
      last_commit_step:0,
      last_commit_path:null,
      last_push_step:0,
      last_push_path:null
    }
  });
  assert.equal(state.next_step,8);
  assert.equal(state.coding.last_mutation_step,7);
});

test("visual pointer drag is gated by fresh screen inspection before and after",()=>{
  let state=agent.createAgentOrchestrationState();
  const drag={tool:"pointer_drag",arguments:{x1:50,y1:80,x2:200,y2:100,duration_ms:500}};
  const unsafe=agent.evaluateProposal(state,drag);
  assert.equal(unsafe.allowed,false);
  assert.match(unsafe.reason,/inspect_screen/);
  state={...state,last_tool:"inspect_screen",last_outcome:"success"};
  assert.equal(agent.evaluateProposal(state,drag).allowed,true);
  state={...state,last_tool:"pointer_drag",last_outcome:"success"};
  const premature=agent.evaluateProposal(state,{tool:"read_file",arguments:{path:"/a"}});
  assert.equal(premature.allowed,false);
  assert.match(premature.reason,/Verify the pointer drag/);
  assert.equal(agent.evaluateProposal(state,{tool:"inspect_screen",arguments:{prompt:"verify result"}}).allowed,true);
});


test("owner-authorized continuation persists steps above eight without implicit escalation",()=>{
 let s=agent.createAgentOrchestrationState(24);
 for(let i=0;i<10;i++){
   const p={tool:"list_processes",arguments:{filter:"p"+i}};
   assert.equal(agent.evaluateProposal(s,p).allowed,true);
   s=agent.recordToolOutcome(s,p,"success",result("list_processes"));
 }
 assert.equal(s.next_step,11);
 assert.equal(s.tool_actions,10);
 assert.equal(s.max_steps,24);
 const restored=agent.normalizeAgentOrchestrationState(json(s));
 assert.equal(restored.recovery_mode,"normal");
 assert.equal(restored.next_step,11);
 assert.equal(restored.max_steps,24);
 assert.equal(agent.evaluateProposal(restored,{tool:"list_processes",arguments:{filter:"new"}}).allowed,true);
 const elevated=json(s);
 elevated.max_steps=48;
 delete elevated.task_expires_at_ms;
 assert.equal(agent.normalizeAgentOrchestrationState(elevated).recovery_mode,"stopped");
 const expired=json(s);
 expired.task_expires_at_ms=Date.now()-1000;
 assert.equal(agent.normalizeAgentOrchestrationState(expired).recovery_mode,"stopped");
});


test("extended owner graph completes ten dependent steps, persists audited receipts, and appends a stage",()=>{
  const firstTen=Array.from({length:10},(_,i)=>step("long"+i,i?["long"+(i-1)]:[],"read_file"));
  const metadata=plan(firstTen,1);
  assert.equal(graph.parseTaskGraph(metadata).ok,false,"default legacy eight-step plan remains bounded");
  assert.equal(graph.parseTaskGraph(metadata,24).ok,true,"owner 24-step contract permits extended graph");
  assert.equal(graph.parseTaskGraph(metadata,8).ok,false);
  let state=agent.createAgentOrchestrationState(24);
  const first=proposal("long0","read_file",{task_graph:metadata,arguments:{path:"/repo/long0.txt"}});
  state=agent.acceptProposalGraph(state,first).state;
  assert.equal(state.task_graph.steps.length,10);
  for(let i=0;i<10;i++){
    const p=proposal("long"+i,"read_file",{arguments:{path:"/repo/long"+i+".txt"}});
    state=done(state,p,result("read_file"));
  }
  assert.equal(state.next_step,11);
  assert.equal(graph.taskGraphProgress(state.task_graph).completed,10);
  const saved=json(state);
  const resumed=agent.normalizeAgentOrchestrationState(saved);
  assert.equal(resumed.recovery_mode,"normal");
  assert.equal(resumed.task_graph.steps.length,10);
  assert.equal(graph.taskGraphProgress(resumed.task_graph).completed,10);
  assert.equal(resumed.task_graph.steps[9].evidence[0].orchestration_step,10);
  const expanded=plan([...firstTen,step("long10",["long9"],"read_file")],2);
  const next=proposal("long10","read_file",{task_graph:expanded,arguments:{path:"/repo/long10.txt"}});
  const change=agent.acceptProposalGraph(resumed,next);
  assert.equal(change.event,"task_graph_replanned");
  assert.equal(change.state.task_graph.steps.length,11);
  assert.equal(graph.taskGraphProgress(change.state.task_graph).completed,10);
  assert.deepEqual(change.state.task_graph.steps[0].evidence,resumed.task_graph.steps[0].evidence);
  const completed=done(change.state,proposal("long10","read_file",{arguments:{path:"/repo/long10.txt"}}),result("read_file"));
  assert.equal(graph.taskGraphProgress(completed.task_graph).completed,11);
});

test("extended planner is still capped to owner budget and cannot erase verified steps",()=>{
 const ten=Array.from({length:10},(_,i)=>step("s"+i,[],"read_file"));
 const current=graph.reviseTaskGraph(null,plan(ten),null,0,24);
 assert.equal(current.ok,true);
 const over=plan(Array.from({length:25},(_,i)=>step("s"+i,[],"read_file")));
 assert.equal(graph.reviseTaskGraph(current.graph,over,current.graph.objective,0,24).ok,false);
 assert.equal(graph.parseTaskGraph(plan(undefined,25),24).ok,false);
 assert.equal(graph.parseTaskGraph(plan(undefined,24),24).ok,true);
 assert.equal(graph.restoreTaskGraph(current.graph,1,8).ok,false);
});

test("same Rust action UUID cannot be rebound to a second graph worker",()=>{
 const first=done(initial(),proposal());
 const p=proposal("edit","replace_text");
 assert.equal(agent.evaluateProposal(first,p).allowed,true);
 const running=agent.recordProposalStart(first,p);
 const receipt=first.task_graph.steps[0].evidence[0].action_id;
 const reused=agent.bindPreparedAction(running,p,receipt);
 assert.equal(reused.ok,false);
 assert.match(reused.error,/already been used by another worker/);
 assert.equal(runningActionId(reused.state,p),null);
 const fresh=agent.bindPreparedAction(running,p,actionIdFor(2));
 assert.equal(fresh.ok,true);
 assert.equal(runningActionId(fresh.state,p),actionIdFor(2));
});

test("crash recovery rejects two completed worker steps with the same action UUID",()=>{
 let state=done(initial(),proposal());
 state=done(state,proposal("edit","replace_text"));
 const checkpoint=json(state.task_graph);
 assert.equal(graph.restoreTaskGraph(checkpoint,state.next_step,state.max_steps).ok,true);
 const receipt=checkpoint.steps[0].evidence[0].action_id;
 checkpoint.steps[1].evidence[0].action_id=receipt;
 const restored=graph.restoreTaskGraph(checkpoint,state.next_step,state.max_steps);
 assert.equal(restored.ok,false);
 assert.match(restored.error,/Duplicate native action ID/);
});

test("Master sees only permission-gated, audit-proven next worker handoffs",()=>{
 const state=done(initial(),proposal());
 const ready=graph.nextWorkerTurn(state.task_graph);
 assert.equal(ready.step_id,"edit");
 assert.equal(ready.worker,"coding");
 assert.equal(ready.tool,"replace_text");
 assert.equal(ready.requires_owner_approval,true);
 assert.equal(ready.handoffs[0].from_step_id,"inspect");
 assert.equal(ready.handoffs[0].action_id,state.task_graph.steps[0].evidence[0].action_id);
 assert.match(agent.orchestrationContext(state),/next audited-safe worker handoff/);
 assert.match(agent.orchestrationContext(state),/normal typed prepare\/Allow once\/audit flow/);
});

test("typed result without matching action receipt cannot mark graph completed or unlock worker",()=>{
 const g=json(initial().task_graph);
 g.steps[0].status="completed";
 g.steps[0].evidence=[{
  step_id:"inspect",tool:"read_file",fingerprint:"claimed",action_id:null,
  audit_event:null,success:true,outcome:"success",source:"typed_result",
  orchestration_step:1,summary:"Model says done"
 }];
 assert.equal(graph.taskGraphProgress(g).completed,0);
 assert.match(graph.graphDependencyFailure(g,proposal("edit","replace_text")),/Task dependency missing: inspect/);
 assert.equal(graph.nextWorkerTurn(g),null,
  "completed-looking but unaudited evidence must not become cross-worker authority");
});

test("Blender inspection-to-model-to-Premiere insertion is a real typed worker chain",()=>{
 const p=plan([
  step("inspect3d",[],"blender_inspect"),
  step("model3d",["inspect3d"],"blender_run_plan"),
  step("insert",["model3d"],"premiere_insert_media")
 ]);
 let state=initial(p);
 assert.equal(graph.nextWorkerTurn(state.task_graph).worker,"blender");
 assert.equal(agent.evaluateProposal(state,proposal("insert","premiere_insert_media")).allowed,false);
 state=done(state,proposal("inspect3d","blender_inspect"));
 assert.equal(graph.nextWorkerTurn(state.task_graph).step_id,"model3d");
 state=done(state,proposal("model3d","blender_run_plan"));
 const next=graph.nextWorkerTurn(state.task_graph);
 assert.equal(next.step_id,"insert");
 assert.equal(next.worker,"premiere");
 assert.equal(next.handoffs[0].from_worker,"blender");
 assert.equal(next.handoffs[0].to_worker,"premiere");
 assert.equal(next.requires_owner_approval,true);
 assert.equal(graph.taskGraphProgress(state.task_graph).completed,2);
 const saved=json(state.task_graph);
 assert.equal(graph.restoreTaskGraph(saved,state.next_step,state.max_steps).ok,true);
 state=done(state,proposal("insert","premiere_insert_media",
  {arguments:{path:"/repo/blender.png"}}));
 assert.equal(graph.taskGraphProgress(state.task_graph).completed,3);
 assert.equal(graph.nextWorkerTurn(state.task_graph),null);
});

test("an untrusted caller cannot bypass bindPreparedAction to reuse an audited worker receipt",()=>{
 const previous=done(initial(),proposal());
 const newProposal=proposal("edit","replace_text");
 const running=agent.recordProposalStart(previous,newProposal);
 const oldId=previous.task_graph.steps[0].evidence[0].action_id;
 const target=running.task_graph.steps.find(x=>x.step_id==="edit");
 target.running.action_id=oldId; // forged local state bypasses normal binding
 const attempted=agent.recordToolOutcome(running,newProposal,"success",result("replace_text"),true,
  oldId,auditReceipt(oldId,"replace_text",true,"executed"));
 assert.equal(attempted.task_graph.steps[1].status,"failed");
 assert.equal(graph.taskGraphProgress(attempted.task_graph).completed,0,
  "a forged duplicate UUID taints the original worker handoff too");
 assert.equal(attempted.task_graph.steps[1].evidence.at(-1).source,"local_failure");
});

test("owner-selected 24/48-step graph does not drop worker handoff validation after step eight",()=>{
 for(const cap of [24,48]){
  const steps=Array.from({length:cap},(_,i)=>step("job"+i));
  const proposalForGraph=proposal("job0","read_file",{task_graph:plan(steps)});
  const initialState=agent.createAgentOrchestrationState(cap);
  const acceptedGraph=agent.acceptProposalGraph(initialState,proposalForGraph);
  assert.equal(acceptedGraph.state.task_graph.steps.length,cap);
  assert.equal(graph.nextWorkerTurn(acceptedGraph.state.task_graph).step_id,"job0");
  const last=proposal("job"+(cap-1),"read_file",{arguments:{path:"/repo/last.ts"}});
  assert.equal(agent.evaluateProposal(acceptedGraph.state,last).allowed,true);
  const started=agent.recordProposalStart(acceptedGraph.state,last);
  assert.equal(started.task_graph.steps[cap-1].status,"running");
  assert.equal(graph.graphDependencyFailure(started.task_graph,proposal("job1","read_file")),
   "Worker lane is busy, unavailable, or lacks exact Rust-audited dependency evidence.");
 }
});

test("Master progress refuses premature child completion even with a synthetic typed receipt",()=>{
 const initialState=done(initial(),proposal());
 const g=json(initialState.task_graph);
 const original=g.steps[0].evidence[0];
 g.steps[0].evidence[0].orchestration_step=3;
 g.steps[1].status="completed";
 g.steps[1].evidence=[{...original,step_id:"edit",tool:"replace_text",
  fingerprint:"second",action_id:actionIdFor(2),orchestration_step:2}];
 assert.equal(graph.taskGraphProgress(g).completed,1,
  "the earlier child action cannot precede its audited dependency");
 assert.equal(graph.nextWorkerTurn(g),null);
 const ctx=agent.orchestrationContext({...initialState,task_graph:g});
 assert.match(ctx,/verified completed IDs: inspect/);
 assert.doesNotMatch(ctx,/verified completed IDs: inspect,edit/);
});

test("real task graph will not stage Remotion-to-Premiere media before final acceptance and planning",()=>{
 const invalid=plan([
  step("render",[],"motion_graphics_run_remotion"),
  step("insert",["render"],"premiere_insert_media")
 ]);
 let state=initial(invalid);
 state=done(state,proposal("render","motion_graphics_run_remotion"));
 assert.equal(graph.taskGraphProgress(state.task_graph).completed,1);
 const candidate=proposal("insert","premiere_insert_media");
 const denied=agent.evaluateProposal(state,candidate);
 assert.equal(denied.allowed,false);
 assert.match(denied.reason,/motion_graphics_accept_final_remotion/);
 assert.equal(graph.nextWorkerTurn(state.task_graph),null);
 const fake=json(state.task_graph);
 fake.steps[1].status="completed";
 fake.steps[1].evidence=[{
  step_id:"insert",tool:"premiere_insert_media",fingerprint:"fabricated",
  action_id:actionIdFor(2),audit_event:"executed",success:true,outcome:"success",
  source:"typed_result",orchestration_step:2,summary:"Fake completion"
 }];
 assert.equal(graph.taskGraphProgress(fake).completed,1);
 const restored=graph.restoreTaskGraph(fake,3);
 assert.equal(restored.ok,false);
 assert.match(restored.error,/cross-app artifact acceptance/);
});

test("Remotion accepted-final -> Premiere insertion plan -> native import survives checkpoint recovery",()=>{
 const valid=plan([
  step("render",[],"motion_graphics_run_remotion"),
  step("accept",["render"],"motion_graphics_accept_final_remotion"),
  step("insertion_plan",["accept"],"motion_graphics_plan_premiere_insertion"),
  step("import",["insertion_plan"],"premiere_insert_media"),
  step("review",["import"],"premiere_timeline")
 ]);
 let state=initial(valid);
 assert.equal(graph.nextWorkerTurn(state.task_graph).step_id,"render");
 state=done(state,proposal("render","motion_graphics_run_remotion"));
 assert.equal(agent.evaluateProposal(state,proposal("import","premiere_insert_media")).allowed,false);
 assert.equal(graph.nextWorkerTurn(state.task_graph).step_id,"accept");
 state=done(state,proposal("accept","motion_graphics_accept_final_remotion"));
 assert.equal(graph.nextWorkerTurn(state.task_graph).step_id,"insertion_plan");
 state=done(state,proposal("insertion_plan","motion_graphics_plan_premiere_insertion"));
 assert.equal(graph.nextWorkerTurn(state.task_graph).step_id,"import");
 assert.equal(agent.evaluateProposal(state,proposal("import","premiere_insert_media")).allowed,true);
 const saved=json(state);
 const resumed=agent.normalizeAgentOrchestrationState(saved);
 assert.equal(resumed.recovery_mode,"normal");
 assert.equal(graph.taskGraphProgress(resumed.task_graph).completed,3);
 assert.equal(graph.nextWorkerTurn(resumed.task_graph).step_id,"import");
 state=done(resumed,proposal("import","premiere_insert_media"));
 assert.equal(graph.nextWorkerTurn(state.task_graph).step_id,"review");
 state=done(state,proposal("review","premiere_timeline"));
 assert.equal(graph.taskGraphProgress(state.task_graph).completed,5);
 assert.equal(graph.nextWorkerTurn(state.task_graph),null);
});

test("Premiere insertion for unrelated independently inspected assets remains available",()=>{
 const g=plan([
  step("context",[],"premiere_context"),
  step("insert",["context"],"premiere_insert_media")
 ]);
 let state=initial(g);
 state=done(state,proposal("context","premiere_context"));
 assert.equal(agent.evaluateProposal(state,proposal("insert","premiere_insert_media")).allowed,true);
 assert.equal(graph.nextWorkerTurn(state.task_graph).step_id,"insert");
});

test("Master planning context exposes missing acceptance rather than claiming a finished import",()=>{
 const metadata=plan([
  step("render",[],"motion_graphics_run_remotion"),
  step("import",["render"],"premiere_insert_media")
 ]);
 let state=initial(metadata);
 state=done(state,proposal("render","motion_graphics_run_remotion"));
 const context=agent.orchestrationContext(state);
 assert.match(context,/REQUIRED cross-app handoff repair/);
 assert.match(context,/motion_graphics_accept_final_remotion/);
 assert.match(context,/never skip missing evidence/);
 assert.doesNotMatch(context,/next audited-safe worker handoff: step import/);
});

test("a forged running import receipt cannot bypass final cross-app handoff admission",()=>{
 const p=plan([
  step("render",[],"motion_graphics_run_remotion"),
  step("import",["render"],"premiere_insert_media")
 ]);
 let s=done(initial(p),proposal("render","motion_graphics_run_remotion"));
 const importProposal=proposal("import","premiere_insert_media");
 const id=actionIdFor(2);
 const target=s.task_graph.steps.find(x=>x.step_id==="import");
 target.status="running"; // simulate an untrusted checkpoint bypassing the admission path
 target.running={fingerprint:agent.proposalFingerprint(importProposal),orchestration_step:s.next_step,action_id:id};
 const attempted=agent.recordToolOutcome(s,importProposal,"success",result("premiere_insert_media"),
  true,id,auditReceipt(id,"premiere_insert_media",true,"executed"));
 assert.equal(attempted.task_graph.steps[1].status,"failed");
 assert.equal(graph.taskGraphProgress(attempted.task_graph).completed,1);
 assert.match(attempted.task_graph.steps[1].evidence.at(-1).summary,/accepted artifact SHA-256/);
 assert.equal(attempted.recovery_mode,"replan_required");
});
