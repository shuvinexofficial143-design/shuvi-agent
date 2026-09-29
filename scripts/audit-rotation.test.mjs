import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("audit writes are serialized and size-bounded by rotation",()=>{
  assert.match(rust,/const MAX_AUDIT_LOG_BYTES: u64 = 8 \* 1024 \* 1024/);
  assert.match(rust,/fn audit_io_lock\(\) -> &'static Mutex<\(\)>/);
  assert.match(rust,/OnceLock<Mutex<\(\)>>/);
  const start=rust.indexOf("fn append_audit(");
  const end=rust.indexOf("fn read_audit(",start);
  const block=rust.slice(start,end);
  assert.match(block,/audit_io_lock\(\)[\s\S]*\.lock\(\)/);
  assert.match(block,/metadata\.len\(\) >= MAX_AUDIT_LOG_BYTES/);
  assert.match(block,/with_extension\("jsonl\.1"\)/);
  assert.match(block,/fs::rename\(&path, &rotated\)/);
  assert.match(block,/OpenOptions::new\(\)[\s\S]*\.append\(true\)/);
});

test("audit reads share the same I/O lock with rotation",()=>{
  const start=rust.indexOf("fn read_audit(");
  const end=rust.indexOf("fn capture_screen_png",start);
  const block=rust.slice(start,end);
  assert.match(block,/audit_io_lock\(\)[\s\S]*\.lock\(\)/);
  assert.match(block,/limit\.clamp\(1, 200\)/);
});
