import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const code=readFileSync(new URL("../src-tauri/src/native_windows_job.rs",import.meta.url),"utf8");
const parent=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
test("process created suspended, contained, then resumed",()=>{
  const a=code.indexOf("let ok=unsafe{CreateProcessW");
  const b=code.indexOf("let assigned=unsafe{AssignProcessToJobObject");
  const c=code.indexOf("let resumed=unsafe{ResumeThread");
  assert.ok(a>=0&&b>a&&c>b);
  assert.match(code,/CREATE_SUSPENDED\|CREATE_NO_WINDOW/);
  assert.match(code,/limit\.basic\.flags=KILL_ON_CLOSE\|JOB_OBJECT_LIMIT_JOB_MEMORY/);
  assert.match(code,/MAX_JOB_MEMORY_BYTES:u64=4\*1024\*1024\*1024/);
  assert.match(code,/if assigned==0/);
  assert.match(code,/TerminateProcess\(process\.0,1\)/);
});
test("dead parent does not free live descendants or fabricate verified output",()=>{
  assert.match(parent,/self\.child\.active_processes\(\)\?==0/);
  assert.match(parent,/descendants_running/);
  assert.match(parent,/self\.child\.terminate_tree\(\)\?/);
  assert.match(parent,/app_progress_verified:false/);
});
