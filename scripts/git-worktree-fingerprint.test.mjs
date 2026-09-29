import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const orchestration=readFileSync(new URL("../src/agent-orchestrator.ts",import.meta.url),"utf8");

test("git receipts bind branch and HEAD to a content-sensitive worktree fingerprint",()=>{
  const contextStart=rust.indexOf("fn git_local_context");
  const contextEnd=rust.indexOf("fn git_context_stdout",contextStart);
  const context=rust.slice(contextStart,contextEnd);
  assert.match(context,/git_worktree_fingerprint\(path\)\?/);
  assert.match(context,/"worktree_fingerprint": worktree_fingerprint/);

  const sameStart=rust.indexOf("fn git_same_local_snapshot");
  const sameEnd=rust.indexOf("fn require_expected_git_head",sameStart);
  assert.match(rust.slice(sameStart,sameEnd),/worktree_fingerprint/);

  const fpStart=rust.indexOf("fn git_worktree_fingerprint");
  const fpEnd=rust.indexOf("fn require_expected_git_worktree",fpStart);
  const fp=rust.slice(fpStart,fpEnd);
  assert.match(fp,/\["diff", "HEAD", "--no-ext-diff", "--binary", "--"\]/);
  assert.match(fp,/\["ls-files", "--others", "--exclude-standard", "-z"\]/);
  assert.match(fp,/\["hash-object", "--no-filters", "--", file\.as_str\(\)\]/);
  assert.match(fp,/\["hash-object", "--stdin"\]/);
});

test("git_commit is bound to the exact reviewed worktree snapshot",()=>{
  assert.match(rust,/expected_worktree_fingerprint/);
  const executeStart=rust.indexOf("ToolAction::GitCommit { path, message, files, expected_head, expected_worktree_fingerprint }");
  const executeEnd=rust.indexOf("ToolAction::GitPush",executeStart);
  const execute=rust.slice(executeStart,executeEnd);
  assert.match(execute,/require_expected_git_worktree\(&path, &expected_worktree_fingerprint, "git_commit"\)\?/);
  assert.match(execute,/git_commit after remote freshness check/);
  assert.match(execute,/git_commit before staging/);

  assert.match(orchestration,/worktree_fingerprint: string/);
  assert.match(orchestration,/statusGit\.worktree_fingerprint === diffGit\.worktree_fingerprint/);
  assert.match(orchestration,/expected_worktree_fingerprint/);
  assert.match(orchestration,/expectedWorktree !== statusGit\?\.worktree_fingerprint/);
});
