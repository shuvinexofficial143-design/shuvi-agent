import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("git_commit stages only exact reviewed files",()=>{
  assert.match(rust,/GitCommit \{ path: String, message: String, files: Vec<String>, expected_head: String \}/);
  assert.match(rust,/git_commit requires between 1 and 64 exact reviewed relative file paths/);
  assert.match(rust,/files must name exact files, not directories/);
  const execution=rust.slice(rust.indexOf("ToolAction::GitCommit { path, message, files, expected_head }"),rust.indexOf("ToolAction::GitPush { path, expected_head }"));
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
  const commit=rust.slice(rust.indexOf("ToolAction::GitCommit { path, message, files, expected_head }"),rust.indexOf("ToolAction::GitPush { path, expected_head }"));
  const pushStart=rust.indexOf("ToolAction::GitPush { path, expected_head }");
  const push=rust.slice(pushStart,rust.indexOf("ToolAction::PowerShell",pushStart));
  assert.ok(commit.indexOf("git_remote_freshness(&path, false)") < commit.indexOf("git_staged_files(&path)"));
  assert.ok(push.indexOf("git_remote_freshness(&path, true)") < push.indexOf('run_git(&path, &["push", "--", remote.as_str(), refspec.as_str()])'));
  assert.match(commit,/Remote freshness: \{remote_receipt\}/);
  assert.match(push,/Remote freshness: \{remote_receipt\}/);
});

test("tool protocol requires reviewed commit file list",()=>{
  assert.match(rust,/- git_commit: \{"path":"absolute repository path","message":"commit message","files":\["exact\/relative\/file1","exact\/relative\/file2"\],"expected_head":/);
  assert.match(rust,/pass only the exact reviewed relative files/);
});


test("typed Git results carry bounded repository identity receipts",()=>{
  assert.match(rust,/fn git_local_context\(path: &str\) -> Result<Value, String>/);
  assert.match(rust,/"repo_root": repo_root/);
  assert.match(rust,/"branch": branch/);
  assert.match(rust,/"head": head/);
  assert.match(rust,/"upstream": upstream/);
  assert.match(rust,/"upstream_head": upstream_head/);
  assert.match(rust,/\[SHUVI_GIT_CONTEXT_V1\]/);
  const status=rust.slice(
    rust.indexOf("ToolAction::GitStatus { path }"),
    rust.indexOf("ToolAction::GitDiff { path }")
  );
  const diff=rust.slice(
    rust.indexOf("ToolAction::GitDiff { path }"),
    rust.indexOf("ToolAction::GitCommit { path, message, files, expected_head }")
  );
  assert.match(status,/\[SHUVI_GIT_CONTEXT_V1\]/);
  assert.match(diff,/\[SHUVI_GIT_CONTEXT_V1\]/);
  for(const arm of [
    "ToolAction::GitCommit { path, message, files, expected_head }",
    "ToolAction::GitPush { path, expected_head }"
  ]) {
    const start=rust.indexOf(arm);
    assert.ok(start>=0);
    assert.match(rust.slice(start,start+5200),/git_context_stdout\(&path/);
  }
});

test("project validation refuses commit-bound evidence if HEAD changes mid-task",()=>{
  const start=rust.indexOf("ToolAction::RunProjectTask { path, task }");
  const end=rust.indexOf("ToolAction::GitStatus { path }",start);
  const block=rust.slice(start,end);
  assert.match(block,/let git_before = if Path::new\(&path\)\.join\("\.git"\)\.exists\(\)/);
  assert.match(block,/before\.get\("head"\) != after\.get\("head"\)/);
  assert.match(block,/Git HEAD changed while the validation task was running/);
  assert.match(block,/\[SHUVI_GIT_CONTEXT_V1\]/);
});


test("git writes require the exact reviewed local HEAD",()=>{
  assert.match(rust,/fn arg_git_head\(arguments: &Value, name: &str\)/);
  assert.match(rust,/expected_head":"exact local HEAD copied from the latest matching git_status\/git_diff receipt/);
  assert.match(rust,/expected_head":"exact committed HEAD copied from the successful git_commit receipt/);
  assert.match(rust,/fn require_expected_git_head\(path: &str, expected_head: &str, action: &str\)/);
  const commit=rust.slice(
    rust.indexOf("ToolAction::GitCommit { path, message, files, expected_head }"),
    rust.indexOf("ToolAction::GitPush { path, expected_head }")
  );
  assert.match(commit,/require_expected_git_head\(&path, &expected_head, "git_commit"\)/);
  assert.match(commit,/require_expected_git_head\(&path, &expected_head, "git_commit after remote freshness check"\)/);
  assert.match(commit,/require_expected_git_head\(&path, &expected_head, "git_commit after staging"\)/);
  assert.match(commit,/require_expected_git_head\(&path, &expected_head, "git_commit after final remote freshness check"\)/);
  const pushStart=rust.indexOf("ToolAction::GitPush { path, expected_head }");
  const push=rust.slice(pushStart,rust.indexOf("ToolAction::PowerShell",pushStart));
  assert.match(push,/require_expected_git_head\(&path, &expected_head, "git_push"\)/);
  assert.match(push,/require_expected_git_head\(&path, &expected_head, "git_push after remote freshness check"\)/);
});

test("git_diff reviews the combined tracked delta against HEAD",()=>{
  const start=rust.indexOf("ToolAction::GitDiff { path }");
  const end=rust.indexOf("ToolAction::GitCommit",start);
  const block=rust.slice(start,end);
  assert.match(block,/\["diff", "HEAD", "--no-ext-diff", "--unified=3", "--"\]/);
  assert.doesNotMatch(block,/\["diff", "--no-ext-diff", "--unified=3"\]/);
});


test("git_push refuses to write without a configured upstream",()=>{
  const helper=rust.slice(rust.indexOf("fn git_remote_freshness"),rust.indexOf("fn project_task_command"));
  assert.match(helper,/require_upstream: bool/);
  assert.match(helper,/git_push requires a configured upstream branch so remote freshness can be verified/);
  const commit=rust.slice(
    rust.indexOf("ToolAction::GitCommit { path, message, files, expected_head }"),
    rust.indexOf("ToolAction::GitPush { path, expected_head }")
  );
  const push=rust.slice(
    rust.indexOf("ToolAction::GitPush { path, expected_head }"),
    rust.indexOf("ToolAction::PowerShell",rust.indexOf("ToolAction::GitPush { path, expected_head }"))
  );
  assert.match(commit,/git_remote_freshness\(&path, false\)/);
  assert.match(push,/git_remote_freshness\(&path, true\)/);
});


test("git_status expands untracked files for exact commit review",()=>{
  const start=rust.indexOf("ToolAction::GitStatus { path }");
  const end=rust.indexOf("ToolAction::GitDiff { path }",start);
  const block=rust.slice(start,end);
  assert.match(block,/\["status", "--short", "--branch", "--untracked-files=all"\]/);
});


test("Git inspection receipts require a stable local HEAD and branch",()=>{
  assert.match(rust,/fn git_same_local_snapshot\(before: &Value, after: &Value\) -> bool/);
  const status=rust.slice(
    rust.indexOf("ToolAction::GitStatus { path }"),
    rust.indexOf("ToolAction::GitDiff { path }")
  );
  const diff=rust.slice(
    rust.indexOf("ToolAction::GitDiff { path }"),
    rust.indexOf("ToolAction::GitCommit { path, message, files, expected_head }")
  );
  for(const block of [status,diff]){
    assert.match(block,/let before = git_local_context\(&path\)\?/);
    assert.match(block,/let after = git_local_context\(&path\)\?/);
    assert.match(block,/!git_same_local_snapshot\(&before, &after\)/);
    assert.match(block,/HEAD or branch changed/);
    assert.match(block,/\[SHUVI_GIT_CONTEXT_V1\]/);
  }
});

test("Git writes recheck reviewed HEAD after freshness and staging boundaries",()=>{
  assert.match(rust,/fn require_expected_git_head\(path: &str, expected_head: &str, action: &str\)/);
  const commit=rust.slice(
    rust.indexOf("ToolAction::GitCommit { path, message, files, expected_head }"),
    rust.indexOf("ToolAction::GitPush { path, expected_head }")
  );
  assert.match(commit,/require_expected_git_head\(&path, &expected_head, "git_commit"\)/);
  assert.match(commit,/git_remote_freshness\(&path, false\)/);
  assert.match(commit,/git_commit after remote freshness check/);
  assert.match(commit,/git_commit after staging/);
  const freshnessChecks=[...commit.matchAll(/git_remote_freshness\(&path, false\)/g)];
  assert.equal(freshnessChecks.length,2);
  assert.ok(commit.indexOf("git_commit after staging") < freshnessChecks[1].index);
  assert.ok(freshnessChecks[1].index < commit.indexOf('run_git(&path, &["commit", "-m", &message])'));
  assert.match(commit,/git_commit after final remote freshness check/);
  const pushStart=rust.indexOf("ToolAction::GitPush { path, expected_head }");
  const push=rust.slice(pushStart,rust.indexOf("ToolAction::PowerShell",pushStart));
  assert.match(push,/require_expected_git_head\(&path, &expected_head, "git_push"\)/);
  assert.match(push,/git_remote_freshness\(&path, true\)/);
  assert.match(push,/git_push after remote freshness check/);
});


test("git_push sends only the reviewed commit to the configured upstream ref",()=>{
  assert.match(rust,/fn git_push_destination\(path: &str\) -> Result<\(String, String\), String>/);
  assert.match(rust,/branch\.\{branch\}\.merge/);
  assert.match(rust,/merge_ref\.starts_with\("refs\/heads\/"\)/);
  assert.match(rust,/git_push refuses a local-dot upstream/);
  const start=rust.indexOf("ToolAction::GitPush { path, expected_head }");
  const push=rust.slice(start,rust.indexOf("ToolAction::PowerShell",start));
  assert.match(push,/let \(remote, merge_ref\) = git_push_destination\(&path\)\?/);
  assert.match(push,/let refspec = format!\("\{expected_head\}:\{merge_ref\}"\)/);
  assert.match(push,/\["push", "--", remote\.as_str\(\), refspec\.as_str\(\)\]/);
  assert.doesNotMatch(push,/run_git\(&path, &\["push"\]\)/);
  assert.match(push,/Exact push: \{expected_head\} -> \{remote\}\/\{merge_ref\}/);
});
