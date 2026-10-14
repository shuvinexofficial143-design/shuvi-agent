import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const start=rust.indexOf("fn run_git(path: &str, args: &[&str])");
const end=rust.indexOf("fn run_git_with_stdin(",start);
const helper=rust.slice(start,end);
test("A08 Git commands have finite absolute deadlines and bounded stdout/stderr",()=>{
  assert.ok(start>=0&&end>start);
  assert.match(helper,/Some\("fetch"\) \| Some\("push"\)=>Duration::from_secs\(180\)/);
  assert.match(helper,/_=>Duration::from_secs\(90\)/);
  assert.match(helper,/bounded_child::collect_with_deadline\(child, deadline\)/);
  assert.match(helper,/GIT_TERMINAL_PROMPT/);
  assert.doesNotMatch(helper,/\.output\(\)/);
});
test("A08 Git stdin is finite and concurrent with output collection",()=>{
  assert.match(helper,/MAX_GIT_STDIN_BYTES:usize=8\*1024\*1024/);
  assert.match(helper,/input\.len\(\)>MAX_GIT_STDIN_BYTES/);
  assert.match(helper,/std::thread::spawn\(move\|\|/);
  assert.match(helper,/stdin\.write_all\(&owned_input\)/);
  assert.match(helper,/bounded_child::collect_with_deadline\(child,Duration::from_secs\(120\)\)/);
  assert.match(helper,/rx\.recv_timeout\(Duration::from_secs\(1\)\)/);
  assert.doesNotMatch(helper,/\.wait_with_output\(\)/);
});
test("A08 unknown Git mutation outcomes are not automatically retried",()=>{
  assert.match(helper,/Git operation outcome may be unknown; inspect repository before retrying/);
  assert.match(helper,/Inspect external Git state before retrying/);
});
