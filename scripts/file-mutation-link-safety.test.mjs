import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const atomic=readFileSync(new URL("../src-tauri/src/atomic_file.rs",import.meta.url),"utf8");

test("existing file mutations open only after repeated link checks",()=>{
  const checkStart=rust.indexOf("fn reject_existing_symlink_target");
  const checkEnd=rust.indexOf("fn open_existing_file_for_mutation",checkStart);
  const check=rust.slice(checkStart,checkEnd);
  assert.match(check,/fs::symlink_metadata\(path\)/);
  assert.match(check,/metadata\.file_type\(\)\.is_symlink\(\)/);
  assert.match(check,/ErrorKind::NotFound/);

  const openStart=rust.indexOf("fn open_existing_file_for_mutation");
  const openEnd=rust.indexOf("fn read_utf8_open_file_bounded",openStart);
  const open=rust.slice(openStart,openEnd);
  assert.equal((open.match(/reject_existing_symlink_target\(path, label\)/g)??[]).length,2);
  assert.match(open,/OpenOptions::new\(\)[\s\S]*\.read\(true\)[\s\S]*\.write\(true\)[\s\S]*\.open\(path\)/);
  assert.match(open,/\.metadata\(\)[\s\S]*\.is_file\(\)/);
});

test("write_file creates new targets exclusively and stages existing replacements",()=>{
  const start=rust.indexOf("ToolAction::WriteFile { path, content }",rust.indexOf("async fn execute_tool_with_action_id"));
  const end=rust.indexOf("ToolAction::CreateDirectory",start);
  const block=rust.slice(start,end);
  assert.match(block,/fs::symlink_metadata\(target\)/);
  assert.match(block,/ErrorKind::NotFound/);
  assert.match(block,/atomic_file::create_new_verified\(target,content\.as_bytes\(\),"write_file"\)/);
  assert.match(atomic,/fs::hard_link\(&stage,target\)/);
  assert.match(atomic,/ensure_real_directory_ancestors\(parent\)\?/);
  assert.match(atomic,/file\.sync_all\(\)/);
  assert.match(block,/atomic_file::replace_existing\(/);
  assert.match(block,/target,content\.as_bytes\(\),None,"write_file"/);
  assert.match(block,/recovery_backup=Some\(backup\)/);
  assert.doesNotMatch(block,/set_len\(0\)/);
  assert.doesNotMatch(block,/fs::write\(&path/);
});

test("replace_text validates the inspected source then performs atomic replacement",()=>{
  const start=rust.indexOf("ToolAction::ReplaceText { path, old, new_value }",rust.indexOf("async fn execute_tool_with_action_id"));
  const end=rust.indexOf("ToolAction::ApplyPatch",start);
  const block=rust.slice(start,end);
  assert.match(block,/open_existing_file_for_mutation\(Path::new\(&path\), "replace_text"\)/);
  assert.match(block,/read_utf8_open_file_bounded\(/);
  assert.match(block,/drop\(file\)/);
  assert.match(block,/atomic_file::replace_existing\(/);
  assert.match(block,/Some\(source\.as_bytes\(\)\),"replace_text"/);
  assert.doesNotMatch(block,/set_len\(0\)/);
  assert.doesNotMatch(block,/fs::write\(&path/);
});


test("transactional replacement uses a same-directory stage and recovery backup",()=>{
  assert.match(atomic,/OpenOptions::new\(\)\.write\(true\)\.create_new\(true\)\.open\(&stage\)/);
  assert.match(atomic,/file\.sync_all\(\)/);
  assert.match(atomic,/source_fingerprint\(target, label\)/);
  assert.match(atomic,/publish_replacement\(target, &stage, &backup\)/);
  assert.match(atomic,/ReplaceFileW\(/);
  assert.match(atomic,/fs::rename\(staged, target\)/);
  assert.doesNotMatch(atomic,/set_len\(0\)/);
});
