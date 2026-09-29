import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as graph from "../src/task-graph.mjs";

// Execute the real TS coordinator, not a reimplementation or regex-only model.
const source = readFileSync(new URL("../src/agent-orchestrator.ts", import.meta.url), "utf8");
const executable = stripTypeScriptTypes(source).replace('"./task-graph.mjs"',
  JSON.stringify(new URL("../src/task-graph.mjs", import.meta.url).href));
const agent = await import("data:text/javascript;base64," + Buffer.from(executable).toString("base64"));

function step(step_id, depends_on = [], expected_tool = "read_file") {
  return { step_id, title: step_id, purpose: "Inspect the requested target",
    success_criteria: "Expected typed tool succeeds", depends_on, expected_tool };
}
function plan(steps = [step("inspect"), step("edit", ["inspect"], "replace_text")], revision = 1) {
  return { objective: "Fix the bug", revision, steps };
}
function proposal(task_step_id = "inspect", tool = "read_file", extra = {}) {
  return { tool, arguments: { path: "/repo/a.ts" }, task_step_id, ...extra };
}
function result(tool = "read_file", success = true, exit_code = 0) {
  return { tool, success, exit_code, stdout: "observed", stderr: "" };
}
function staged(state, p) {
  assert.equal(agent.evaluateProposal(state, p).allowed, true);
  state = agent.acceptProposalGraph(state, p).state;
  return agent.recordProposalStart(state, p);
}
function done(state, p, r = result(p.tool)) {
  return agent.recordToolOutcome(staged(state, p), p, r.success ? "success" : "failure", r);
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
  const after = agent.recordToolOutcome(s,p,"success",result("git_status"));
  assert.equal(graph.taskGraphProgress(after.task_graph).completed,0);
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
  let s = agent.recordToolOutcome(staged(initial(),p),p,"denied");
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
test("checkpoint v3 round trip preserves evidence and next step", () => {
  const s = done(initial(),proposal());
  const restored = agent.normalizeAgentOrchestrationState(json(s));
  assert.deepEqual(restored,s);
  assert.equal(restored.next_step,2);
  assert.equal(graph.taskGraphProgress(restored.task_graph).completed,1);
});
test("legacy v1/v2 migration starts with no invented graph", () => {
  for (const version of [1,2]) {
    const s = agent.normalizeAgentOrchestrationState({version,next_step:4});
    assert.equal(s.task_graph,null);
    assert.equal(s.next_step,4);
    assert.equal(s.version,3);
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
  let s=agent.createAgentOrchestrationState();
  const p=(tool,path="/repo")=>({tool,arguments:{path}});
  s=done(s,p("git_status"));
  s=done(s,p("apply_patch"));
  assert.equal(agent.evaluateProposal(s,p("git_commit")).allowed,false);
  s=done(s,p("git_status"));
  s=done(s,p("git_diff"));
  assert.equal(agent.evaluateProposal(s,p("git_commit")).allowed,true);
  s=done(s,p("git_commit"));
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
test("UI stages only after local graph/coding checks and persists in-flight state", () => {
  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  const stage=main.slice(main.indexOf("async function stageProposal"),main.indexOf("function clearChatPermission"));
  assert.ok(stage.indexOf("evaluateProposal")<stage.indexOf('"prepare_tool"'));
  assert.ok(stage.indexOf("recordProposalStart")<stage.indexOf('"save_session_checkpoint"'));
  assert.ok(stage.indexOf('"save_session_checkpoint"')<stage.indexOf('"prepare_tool"'));
  assert.match(main,/taskGraphProgress\(orchestration.task_graph\)/);
  assert.match(main,/row.textContent/);
  assert.match(main,/result.success \? "success" : "failure",\s+result/);
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
