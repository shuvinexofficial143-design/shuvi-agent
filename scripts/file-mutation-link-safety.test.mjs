import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("file mutations reject existing symbolic-link targets",()=>{
  const helperStart=rust.indexOf("fn reject_existing_symlink_target");
  const helperEnd=rust.indexOf("fn read_utf8_file_bounded",helperStart);
  const helper=rust.slice(helperStart,helperEnd);
  assert.match(helper,/fs::symlink_metadata\(path\)/);
  assert.match(helper,/metadata\.file_type\(\)\.is_symlink\(\)/);
  assert.match(helper,/ErrorKind::NotFound/);

  const writeStart=rust.indexOf("ToolAction::WriteFile { path, content }",rust.indexOf("async fn execute_tool_with_action_id"));
  const writeEnd=rust.indexOf("ToolAction::CreateDirectory",writeStart);
  assert.match(rust.slice(writeStart,writeEnd),/reject_existing_symlink_target\(Path::new\(&path\), "write_file"\)\?/);

  const replaceStart=rust.indexOf("ToolAction::ReplaceText { path, old, new_value }",rust.indexOf("async fn execute_tool_with_action_id"));
  const replaceEnd=rust.indexOf("ToolAction::ApplyPatch",replaceStart);
  assert.match(rust.slice(replaceStart,replaceEnd),/reject_existing_symlink_target\(Path::new\(&path\), "replace_text"\)\?/);
});
