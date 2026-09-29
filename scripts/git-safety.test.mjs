import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("git_commit stages only exact reviewed files",()=>{
  assert.match(rust,/GitCommit \{ path: String, message: String, files: Vec<String> \}/);
  assert.match(rust,/git_commit requires between 1 and 64 exact reviewed relative file paths/);
  assert.match(rust,/files must name exact files, not directories/);
  const execution=rust.slice(rust.indexOf("ToolAction::GitCommit { path, message, files }"),rust.indexOf("ToolAction::GitPush { path }"));
  assert.doesNotMatch(execution,/\["add", "-A"\]/);
  assert.match(execution,/format!\("\:\(literal\)\{file\}"\)/);
  assert.match(execution,/unrelated files are already staged/);
  assert.match(execution,/staging contains files outside the reviewed list/);
});

test("git writes recheck refreshed upstream ancestry immediately inside typed tools",()=>{
  const helper=rust.slice(rust.indexOf("fn git_remote_freshness"),rust.indexOf("fn project_task_command"));
  assert.match(helper,/\["fetch", "--prune", remote\.as_str\(\)\]/);
  assert.match(helper,/\["merge-base", "--is-ancestor", "@\{u\}", "HEAD"\]/);
  assert.match(helper,/Remote branch advanced or diverged; refusing Git write/);
  const commit=rust.slice(rust.indexOf("ToolAction::GitCommit { path, message, files }"),rust.indexOf("ToolAction::GitPush { path }"));
  const push=rust.slice(rust.indexOf("ToolAction::GitPush { path }"),rust.indexOf("ToolAction::PowerShell"));
  assert.ok(commit.indexOf("git_remote_freshness(&path)") < commit.indexOf("git_staged_files(&path)"));
  assert.ok(push.indexOf("git_remote_freshness(&path)") < push.indexOf('run_git(&path, &["push"])'));
  assert.match(commit,/Remote freshness: \{remote_receipt\}/);
  assert.match(push,/Remote freshness: \{remote_receipt\}/);
});

test("tool protocol requires reviewed commit file list",()=>{
  assert.match(rust,/- git_commit: \{"path":"absolute repository path","message":"commit message","files":\["exact\/relative\/file1","exact\/relative\/file2"\]\}/);
  assert.match(rust,/pass only the exact reviewed relative files/);
});
