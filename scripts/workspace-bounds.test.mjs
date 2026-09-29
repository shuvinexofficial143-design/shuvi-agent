import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("workspace scan bounds per-directory allocation before sorting",()=>{
  assert.match(rust,/const MAX_WORKSPACE_SCAN_ENTRIES: usize = 1_200/);
  assert.match(rust,/const MAX_WORKSPACE_DIRECTORY_ENTRIES: usize = 2_000/);
  const start=rust.indexOf("fn workspace_scan_recursive");
  const end=rust.indexOf("fn search_text_recursive",start);
  const block=rust.slice(start,end);
  assert.match(block,/\.take\(MAX_WORKSPACE_DIRECTORY_ENTRIES\)/);
  assert.match(block,/output\.len\(\) >= MAX_WORKSPACE_SCAN_ENTRIES/);
  assert.ok(block.indexOf(".take(MAX_WORKSPACE_DIRECTORY_ENTRIES)") < block.indexOf(".collect::<Vec<_>>()"));
});

test("text search has a hard visited-file budget as well as a match budget",()=>{
  assert.match(rust,/const MAX_SEARCH_MATCHES: usize = 150/);
  assert.match(rust,/const MAX_SEARCH_FILES: usize = 5_000/);
  const start=rust.indexOf("fn search_text_recursive");
  const end=rust.indexOf("fn run_git(",start);
  const block=rust.slice(start,end);
  assert.match(block,/visited_files: &mut usize/);
  assert.match(block,/\*visited_files >= MAX_SEARCH_FILES/);
  assert.match(block,/\*visited_files = visited_files\.saturating_add\(1\)/);
  assert.match(block,/matches\.len\(\) >= MAX_SEARCH_MATCHES/);
  const exec=rust.slice(rust.indexOf("ToolAction::SearchText"),rust.indexOf("ToolAction::ReplaceText"));
  assert.match(exec,/let mut visited_files = 0_usize/);
  assert.match(exec,/search_text_recursive\(root, root, &query, 0, &mut matches, &mut visited_files\)/);
});
