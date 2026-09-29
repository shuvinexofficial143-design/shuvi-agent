import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const orchestrator=readFileSync(new URL("../src/agent-orchestrator.ts",import.meta.url),"utf8");
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const types=readFileSync(new URL("../src/types.ts",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("replace_text requires fresh exact file inspection and mutations invalidate stale reads",()=>{
  assert.match(orchestrator,/proposal\.tool === "replace_text"/);
  assert.match(orchestrator,/coding\.inspected_paths\.includes\(path\)/);
  assert.match(orchestrator,/coding\.inspection_steps\[path\]/);
  assert.match(orchestrator,/after its latest Shuvi mutation before replace_text/);
  assert.match(orchestrator,/coding\.inspection_steps\[path\] = step/);
  assert.match(orchestrator,/delete coding\.inspection_steps\[path\]/);
  assert.match(orchestrator,/proposal\.tool === "apply_patch" \|\| !path[\s\S]*coding\.inspection_steps = \{\}/);
  assert.match(orchestrator,/MAX_INSPECTED_PATHS = 12/);
});

test("apply_patch requires fresh same-repository git status after the latest mutation",()=>{
  assert.match(orchestrator,/proposal\.tool === "apply_patch"/);
  assert.match(orchestrator,/coding\.last_git_status_path === path/);
  assert.match(orchestrator,/coding\.last_git_status_git\?\.repo_root === path/);
  assert.match(orchestrator,/coding\.last_git_status_step > coding\.last_mutation_step/);
  assert.match(orchestrator,/fresh git_status for this exact repository after the latest Shuvi mutation before apply_patch/);
  assert.match(orchestrator,/proposal\.tool === "git_status"/);
  assert.match(orchestrator,/coding\.last_git_status_path = exactGit \? path : null/);
});

test("git commit requires fresh status and diff after latest mutation",()=>{
  assert.match(orchestrator,/proposal\.tool === "git_commit"/);
  assert.match(orchestrator,/coding\.last_git_status_step > coding\.last_mutation_step/);
  assert.match(orchestrator,/coding\.last_git_diff_step > coding\.last_mutation_step/);
  assert.match(orchestrator,/same repository branch\/HEAD after the latest edit before git_commit/);
  assert.match(orchestrator,/git_commit expected_head must exactly match the reviewed git_status\/git_diff HEAD/);
  assert.match(orchestrator,/CODE_MUTATION_TOOLS\.has\(proposal\.tool\)/);
});

test("git push requires a same-repository post-edit commit",()=>{
  assert.match(orchestrator,/proposal\.tool === "git_push"/);
  assert.match(orchestrator,/coding\.last_commit_path === path/);
  assert.match(orchestrator,/coding\.last_commit_step > coding\.last_mutation_step/);
  assert.match(orchestrator,/successful identity-bound git_commit for this repository must follow the latest edit before git_push/);
  assert.match(orchestrator,/git_push expected_head must exactly match the successful git_commit HEAD/);
});

test("validation is tracked but is not fabricated as a hard pass",()=>{
  assert.match(orchestrator,/proposal\.tool === "run_project_task"/);
  assert.match(orchestrator,/coding\.last_validation_step = step/);
  assert.match(orchestrator,/coding\.last_validation_git = exactGit/);
  assert.match(orchestrator,/validation has not succeeded since the latest edit/);
  assert.match(rust,/Validation status is tracked, but a missing validation step alone does not authorize or fabricate a pass\/fail result/);
});

test("coding phases progress from edit through review commit and push",()=>{
  assert.match(orchestrator,/export type CodingPhase/);
  assert.match(orchestrator,/return "commit_ready"/);
  assert.match(orchestrator,/return commitValidated \? "push_ready" : "validate"/);
  assert.match(orchestrator,/return coding\.last_validation_step > coding\.last_mutation_step \? "review" : "validate"/);
  assert.match(orchestrator,/last_push_step > coding\.last_commit_step[\s\S]*last_push_step > coding\.last_mutation_step[\s\S]*return "complete"/);
});

test("mutations and commits invalidate stale review evidence",()=>{
  assert.match(orchestrator,/CODE_MUTATION_TOOLS\.has\(proposal\.tool\)[\s\S]*coding\.last_validation_step = 0/);
  assert.match(orchestrator,/CODE_MUTATION_TOOLS\.has\(proposal\.tool\)[\s\S]*coding\.last_git_status_step = 0/);
  assert.match(orchestrator,/CODE_MUTATION_TOOLS\.has\(proposal\.tool\)[\s\S]*coding\.last_git_diff_step = 0/);
  assert.match(orchestrator,/proposal\.tool === "git_commit"[\s\S]*coding\.last_git_status_step = 0[\s\S]*coding\.last_git_diff_step = 0/);
});

test("checkpoint normalization bounds coding evidence to past steps and drops ambiguous legacy reads",()=>{
  assert.match(types,/inspection_steps\?: Record<string, number>/);
  assert.match(orchestrator,/step > 0 && step < nextStep/);
  assert.match(orchestrator,/rawInspectionSteps === null && rawMutationStep === 0 && nextStep > 1/);
  assert.match(orchestrator,/legacy path evidence is ambiguous and must be re-read after resume/);
  assert.match(orchestrator,/normalizeCodingWorkflowState\(input\.coding, nextStep\)/);
});

test("coding dependency state persists across orchestration v5 and legacy non-graph states",()=>{
  assert.match(types,/export type CodingWorkflowCheckpoint/);
  assert.match(types,/version: 1 \| 2 \| 3 \| 4 \| 5/);
  assert.match(orchestrator,/input\.version !== 1 && input\.version !== 2 && input\.version !== 3 && input\.version !== 4 && input\.version !== 5/);
  assert.match(orchestrator,/input\.version === 2 \|\| input\.version === 3 \|\| input\.version === 4 \|\| input\.version === 5/);
  assert.match(orchestrator,/createCodingWorkflowState\(\)/);
  assert.match(orchestrator,/legacyUnboundGraph = input\.version === 3 && input\.task_graph != null/);
  assert.match(orchestrator,/legacyUnauditedGraph = input\.version === 4 && input\.task_graph != null/);
});

test("UI exposes the current bounded coding phase without bypassing permissions",()=>{
  assert.match(main,/id="agentProgress"/);
  assert.match(main,/codingPhase\(orchestration\)\.replaceAll\("_", " "\)/);
  assert.match(main,/pendingAction = await invoke<PendingAction>\("prepare_tool"/);
  assert.match(main,/renderChatPermission\(proposal, step\)/);
  assert.match(main,/execute_action/);
});


test("future mutation receipt cannot make legacy file inspection look fresh",()=>{
  const state={
    version:5,
    next_step:3,
    coding:{
      active:true,
      inspected_paths:["/repo/a.ts"],
      last_mutation_step:8,
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
  };
  const restored=agent.normalizeAgentOrchestrationState(state);
  assert.deepEqual(restored.coding.inspected_paths,[]);
  assert.deepEqual(restored.coding.inspection_steps,{});
  assert.equal(restored.coding.last_mutation_step,0);
});


test("coding state persists bounded Git identity receipts",()=>{
  assert.match(types,/export type GitIdentityCheckpoint/);
  assert.match(types,/last_git_status_git\?: GitIdentityCheckpoint \| null/);
  assert.match(types,/last_commit_git\?: GitIdentityCheckpoint \| null/);
  assert.match(orchestrator,/function resultGitIdentity\(result: ActionResult \| undefined\)/);
  assert.match(orchestrator,/\[SHUVI_GIT_CONTEXT_V1\]/);
  assert.match(orchestrator,/savedStatusPath === savedStatusGit\.repo_root/);
  assert.match(orchestrator,/savedCommitPath === savedCommitGit\.repo_root/);
  assert.match(orchestrator,/reviewed Git HEAD:/);
  assert.match(orchestrator,/committed Git HEAD:/);
});


test("checkpoint normalization never enumerates unbounded inspection receipt keys",()=>{
  const normalize=orchestrator.slice(
    orchestrator.indexOf("function normalizeCodingWorkflowState"),
    orchestrator.indexOf("export function proposalFingerprint")
  );
  assert.doesNotMatch(normalize,/Object\.entries\(rawInspectionSteps\)/);
  assert.match(normalize,/slice\(-MAX_INSPECTED_PATHS\)/);
  assert.match(normalize,/rawInspectionSteps\[path\]/);
  assert.match(normalize,/never enumerate an unbounded/);
});
