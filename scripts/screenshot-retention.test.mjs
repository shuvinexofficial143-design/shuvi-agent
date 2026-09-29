import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("temporary screenshots have bounded Shuvi-only retention",()=>{
  assert.match(rust,/const MAX_SCREENSHOT_FILES: usize = 64/);
  const prune=rust.slice(
    rust.indexOf("fn prune_screenshot_dir"),
    rust.indexOf("fn capture_screen_png")
  );
  assert.match(prune,/name\.starts_with\("screen-"\)/);
  assert.match(prune,/name\.ends_with\("\.png"\)/);
  assert.match(prune,/screenshots\.sort_by/);
  assert.match(prune,/\.skip\(keep_existing\)/);
  assert.match(prune,/fs::remove_file\(path\)/);
  assert.doesNotMatch(prune,/remove_dir_all/);
});

test("screen capture reserves one retention slot and uses collision-resistant names",()=>{
  const start=rust.indexOf("fn capture_screen_png");
  const end=rust.indexOf("async fn analyze_png_with_provider",start);
  const capture=rust.slice(start,end);
  assert.match(capture,/temp_dir\(\)\.join\("Shuvi"\)\.join\("screenshots"\)/);
  assert.match(capture,/prune_screenshot_dir\(&dir, MAX_SCREENSHOT_FILES\.saturating_sub\(1\)\)/);
  assert.match(capture,/screen-\{\}-\{\}\.png/);
  assert.match(capture,/Uuid::new_v4\(\)/);
});
