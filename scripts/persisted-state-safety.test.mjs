import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("decoded session checkpoints are revalidated before use",()=>{
  assert.match(rust,/fn validate_session_checkpoint_payload\(checkpoint: &SessionCheckpoint\)/);
  const helper=rust.slice(rust.indexOf("fn validate_session_checkpoint_payload"),rust.indexOf("fn write_session_checkpoint"));
  assert.match(helper,/validate_provider_fields\(/);
  assert.match(helper,/checkpoint\.messages\.len\(\) > MAX_CHAT_MESSAGES/);
  assert.match(helper,/message\.content\.len\(\) > MAX_CHAT_MESSAGE_BYTES/);
  assert.match(helper,/total_bytes > MAX_CHAT_CONTEXT_BYTES/);
  const read=rust.slice(rust.indexOf("fn read_session_checkpoint"),rust.indexOf("fn remove_session_checkpoint"));
  assert.match(read,/validate_session_checkpoint_payload\(&checkpoint\)\?/);
});

test("workspace persistence rejects oversized, injected, or stale paths",()=>{
  assert.match(rust,/const MAX_WORKSPACE_PATH_BYTES: u64 = 32 \* 1024/);
  const read=rust.slice(rust.indexOf("fn read_workspace"),rust.indexOf("fn write_workspace"));
  assert.match(read,/\.len\(\) > MAX_WORKSPACE_PATH_BYTES/);
  assert.match(read,/value\.chars\(\)\.any\(char::is_control\)/);
  assert.match(read,/!Path::new\(&value\)\.is_absolute\(\)/);
  assert.match(read,/!Path::new\(&value\)\.is_dir\(\)/);
  const write=rust.slice(rust.indexOf("fn write_workspace"),rust.indexOf("async fn backup_premiere_project"));
  assert.match(write,/path\.chars\(\)\.any\(char::is_control\)/);
  assert.match(write,/path\.len\(\) as u64 > MAX_WORKSPACE_PATH_BYTES/);
});
