import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const orchestrator=readFileSync(new URL("../src/agent-orchestrator.ts",import.meta.url),"utf8");
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const types=readFileSync(new URL("../src/types.ts",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("replace_text requires exact successful file inspection",()=>{
  assert.match(orchestrator,/proposal\.tool === "replace_text"/);
  assert.match(orchestrator,/coding\.inspected_paths\.includes\(path\)/);
  assert.match(orchestrator,/read the exact target file successfully before replace_text/);
  assert.match(orchestrator,/proposal\.tool === "read_file" && path/);
  assert.match(orchestrator,/MAX_INSPECTED_PATHS = 12/);
});

test("apply_patch requires same repository git status first",()=>{
  assert.match(orchestrator,/proposal\.tool === "apply_patch"/);
  assert.match(orchestrator,/coding\.last_git_status_path !== path/);
  assert.match(orchestrator,/inspect git_status for this exact repository before apply_patch/);
  assert.match(orchestrator,/proposal\.tool === "git_status"/);
  assert.match(orchestrator,/coding\.last_git_status_path = path/);
});

test("git commit requires fresh status and diff after latest mutation",()=>{
  assert.match(orchestrator,/proposal\.tool === "git_commit"/);
  assert.match(orchestrator,/coding\.last_git_status_step > coding\.last_mutation_step/);
  assert.match(orchestrator,/coding\.last_git_diff_step > coding\.last_mutation_step/);
  assert.match(orchestrator,/fresh git_status and git_diff for this repository after the latest edit before git_commit/);
  assert.match(orchestrator,/CODE_MUTATION_TOOLS\.has\(proposal\.tool\)/);
});

test("git push requires a same-repository post-edit commit",()=>{
  assert.match(orchestrator,/proposal\.tool === "git_push"/);
  assert.match(orchestrator,/coding\.last_commit_path === path/);
  assert.match(orchestrator,/coding\.last_commit_step > coding\.last_mutation_step/);
  assert.match(orchestrator,/successful git_commit for this repository must follow the latest edit before git_push/);
});

test("validation is tracked but is not fabricated as a hard pass",()=>{
  assert.match(orchestrator,/proposal\.tool === "run_project_task"/);
  assert.match(orchestrator,/coding\.last_validation_step = step/);
  assert.match(orchestrator,/validation has not succeeded since the latest edit/);
  assert.match(rust,/Validation status is tracked, but a missing validation step alone does not authorize or fabricate a pass\/fail result/);
});

test("coding phases progress from edit through review commit and push",()=>{
  assert.match(orchestrator,/export type CodingPhase/);
  assert.match(orchestrator,/return "commit_ready"/);
  assert.match(orchestrator,/return "push_ready"/);
  assert.match(orchestrator,/return coding\.last_validation_step > coding\.last_mutation_step \? "review" : "validate"/);
  assert.match(orchestrator,/last_push_step > coding\.last_commit_step[\s\S]*return "complete"/);
});

test("coding dependency state persists across orchestration v4 and legacy non-graph states",()=>{
  assert.match(types,/export type CodingWorkflowCheckpoint/);
  assert.match(types,/version: 1 \| 2 \| 3 \| 4/);
  assert.match(orchestrator,/input\.version !== 1 && input\.version !== 2 && input\.version !== 3 && input\.version !== 4/);
  assert.match(orchestrator,/input\.version === 2 \|\| input\.version === 3 \|\| input\.version === 4/);
  assert.match(orchestrator,/createCodingWorkflowState\(\)/);
  assert.match(orchestrator,/legacyUnboundGraph = input\.version === 3 && input\.task_graph != null/);
});

test("UI exposes the current bounded coding phase without bypassing permissions",()=>{
  assert.match(main,/id="agentProgress"/);
  assert.match(main,/codingPhase\(orchestration\)\.replaceAll\("_", " "\)/);
  assert.match(main,/pendingAction = await invoke<PendingAction>\("prepare_tool"/);
  assert.match(main,/renderChatPermission\(proposal, step\)/);
  assert.match(main,/execute_action/);
});
