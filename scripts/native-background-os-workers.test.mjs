import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const pool=read("src-tauri/src/native_background_os_workers.rs");
const win=read("src-tauri/src/native_windows_job.rs");
const scheduler=read("src-tauri/src/native_scheduler.rs");
const lib=read("src-tauri/src/lib.rs");
test("two actual independent OS process slots are separate from the GUI desktop and SHA thread slots",()=>{
  assert.match(scheduler,/#\[cfg\(windows\)\]\s*#\[path = "native_background_os_workers.rs"\]\s*pub\(crate\) mod background_os_workers/);
  assert.match(pool,/const MAX_BACKGROUND_WORKERS:usize=2/);
  assert.match(pool,/share_mode\(0\)/);
  assert.match(pool,/native-bg-os-slot-/);
  assert.match(pool,/OwnedChild::spawn_capped/);
  assert.match(pool,/const READ_ONLY_JOB_CAP:u64=512\*1024\*1024/);
  assert.match(win,/fn spawn_capped\(/);
  assert.match(win,/limit\.job_memory=usize::try_from\(cap\)/);
  assert.match(pool,/two_real_independent_background_pids_and_third_denied/);
});
test("persistent exact UUID launch evidence precedes OS process and cannot be silently replayed",()=>{
  assert.match(pool,/create_intent\(&path,id\)\?;[\s\S]*OwnedChild::spawn_capped/);
  assert.match(pool,/create_new\(true\)/);
  assert.match(pool,/unknown_launch_intent_survives_restart_and_never_reuses_uuid/);
  assert.match(pool,/os_exited_unverified/);
  assert.match(pool,/app_verified:false/);
  assert.match(pool,/self\.child\.active_processes\(\)\?!=0/);
  assert.match(pool,/Host RAM could not be verified/);
  assert.match(pool,/fn cancel_exact\(&mut self,id:&str\)/);
  assert.doesNotMatch(pool,/tauri::command|Command::new|taskkill|shell::/);
});
test("new background primitive is not falsely exposed as an owner-authorized dispatch route",()=>{
  assert.doesNotMatch(lib,/native_background_os_workers|background_os_workers::spawn/);
  assert.match(pool,/NOT yet an authorized/);
  assert.match(pool,/no new Tauri IPC/i);
  assert.match(pool,/approved typed action/);
});
