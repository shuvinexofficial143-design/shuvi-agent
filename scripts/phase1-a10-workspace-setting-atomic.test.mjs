import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const write=source.slice(source.indexOf("fn write_workspace("),source.indexOf("async fn backup_premiere_project("));
test("A10 workspace settings use protected atomic creation and replacement",()=>{
 assert.match(write,/persist_workspace_setting\(&workspace_config_path\(app\)\?, path\.as_bytes\(\)\)/);
 assert.match(write,/atomic_file::replace_existing\(/);
 assert.match(write,/atomic_file::create_new_verified\(/);
 assert.match(write,/fs::symlink_metadata\(target\)/);
 assert.doesNotMatch(write,/fs::write\(workspace_config_path\(/);
});
test("A10 workspace settings retain previous bytes and test safely on disposable paths",()=>{
 assert.match(write,/previous_workspace_setting_survives_replacement_as_verified_backup/);
 assert.match(write,/initial_setting_is_fully_published_without_a_stage_file/);
 assert.match(write,/workspace_setting_refuses_to_overwrite_a_directory/);
 assert.match(write,/fs::read\(&backups\[0\]\)/);
});
