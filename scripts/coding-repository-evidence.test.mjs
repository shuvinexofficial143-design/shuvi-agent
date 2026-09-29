import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";

const source=readFileSync(new URL("../src/agent-orchestrator.ts",import.meta.url),"utf8");
const executable=stripTypeScriptTypes(source).replace('"./task-graph.mjs"',
  JSON.stringify(new URL("../src/task-graph.mjs",import.meta.url).href));
const agent=await import("data:text/javascript;base64,"+Buffer.from(executable).toString("base64"));

const HEAD_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HEAD_C="cccccccccccccccccccccccccccccccccccccccc";

function proposal(tool,args={}) {
  return {tool,arguments:{path:"/repo",...args}};
}
function result(tool,stdout="",success=true) {
  return {tool,success,stdout,stderr:"",exit_code:success?0:1};
}
function gitResult(tool,head,branch="main") {
  const receipt={schema:1,repo_root:"/repo",branch,head,upstream:"origin/main",upstream_head:HEAD_A};
  return result(tool,"[SHUVI_GIT_CONTEXT_V1]"+JSON.stringify(receipt)+"\nobserved");
}
function done(state,p,r) {
  return agent.recordToolOutcome(state,p,r.success?"success":"failure",r,true);
}

test("commit requires status and diff from the same repository branch and HEAD",()=>{
  let s=agent.createAgentOrchestrationState();
  s=done(s,proposal("git_status"),gitResult("git_status",HEAD_A));
  assert.equal(agent.evaluateProposal(s,proposal("apply_patch")).allowed,true);
  s=done(s,proposal("apply_patch"),result("apply_patch","patched"));
  s=done(s,proposal("git_status"),gitResult("git_status",HEAD_A));
  s=done(s,proposal("git_diff"),gitResult("git_diff",HEAD_B));
  let decision=agent.evaluateProposal(s,proposal("git_commit",{message:"x",files:["a.ts"],expected_head:HEAD_A}));
  assert.equal(decision.allowed,false);
  assert.match(decision.reason,/same repository branch\/HEAD/);

  s=done(s,proposal("git_diff"),gitResult("git_diff",HEAD_A));
  decision=agent.evaluateProposal(s,proposal("git_commit",{message:"x",files:["a.ts"],expected_head:HEAD_B}));
  assert.equal(decision.allowed,false);
  assert.match(decision.reason,/expected_head/);
  assert.equal(agent.evaluateProposal(s,proposal("git_commit",{message:"x",files:["a.ts"],expected_head:HEAD_A})).allowed,true);
});

test("successful commit invalidates pre-commit validation and can bind validation to committed HEAD",()=>{
  let s=agent.createAgentOrchestrationState();
  s=done(s,proposal("git_status"),gitResult("git_status",HEAD_A));
  s=done(s,proposal("apply_patch"),result("apply_patch","patched"));
  s=done(s,proposal("run_project_task",{task:"test"}),gitResult("run_project_task",HEAD_A));
  s=done(s,proposal("git_status"),gitResult("git_status",HEAD_A));
  s=done(s,proposal("git_diff"),gitResult("git_diff",HEAD_A));
  const commit=proposal("git_commit",{message:"x",files:["a.ts"],expected_head:HEAD_A});
  assert.equal(agent.evaluateProposal(s,commit).allowed,true);
  s=done(s,commit,gitResult("git_commit",HEAD_C));
  assert.equal(s.coding.last_validation_step,0);
  assert.equal(s.coding.last_commit_git.head,HEAD_C);
  assert.equal(agent.codingPhase(s),"validate");

  const push=proposal("git_push",{expected_head:HEAD_C});
  let pushDecision=agent.evaluateProposal(s,push);
  assert.equal(pushDecision.allowed,false);
  assert.match(pushDecision.reason,/exact committed HEAD before git_push/);
  assert.equal(agent.evaluateProposal(s,proposal("git_push",{expected_head:HEAD_A})).allowed,false);

  s=done(s,proposal("run_project_task",{task:"test"}),gitResult("run_project_task",HEAD_C));
  assert.equal(s.coding.last_validation_git.head,HEAD_C);
  assert.equal(agent.evaluateProposal(s,push).allowed,true);
  assert.equal(agent.codingPhase(s),"push_ready");
  s=done(s,push,gitResult("git_push",HEAD_C));
  assert.equal(agent.codingPhase(s),"complete");
});

test("legacy checkpoint Git steps without identity receipts fail closed to fresh inspection",()=>{
  const s=agent.normalizeAgentOrchestrationState({
    version:5,next_step:6,
    coding:{
      active:true,inspected_paths:[],inspection_steps:{},last_mutation_step:2,
      last_validation_step:3,last_git_status_step:4,last_git_status_path:"/repo",
      last_git_diff_step:5,last_git_diff_path:"/repo",
      last_commit_step:0,last_commit_path:null,last_push_step:0,last_push_path:null
    }
  });
  assert.equal(s.coding.last_git_status_step,0);
  assert.equal(s.coding.last_git_diff_step,0);
  assert.equal(s.coding.last_git_status_git,null);
  assert.equal(s.coding.last_git_diff_git,null);
  assert.equal(agent.evaluateProposal(s,proposal("git_commit",{message:"x",files:["a.ts"],expected_head:HEAD_A})).allowed,false);
});


test("push remains allowed when no pre-commit validation evidence was claimed",()=>{
  let s=agent.createAgentOrchestrationState();
  s=done(s,proposal("git_status"),gitResult("git_status",HEAD_A));
  s=done(s,proposal("apply_patch"),result("apply_patch","patched"));
  s=done(s,proposal("git_status"),gitResult("git_status",HEAD_A));
  s=done(s,proposal("git_diff"),gitResult("git_diff",HEAD_A));
  const commit=proposal("git_commit",{message:"x",files:["a.ts"],expected_head:HEAD_A});
  s=done(s,commit,gitResult("git_commit",HEAD_C));
  assert.equal(s.coding.post_commit_validation_required,false);
  assert.equal(agent.evaluateProposal(s,proposal("git_push",{expected_head:HEAD_C})).allowed,true);
});
