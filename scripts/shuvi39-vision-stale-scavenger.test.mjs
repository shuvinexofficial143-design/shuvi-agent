import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const target=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
const main=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("short-lived AI-only captures use distinct vision- names and no manual screenshot purge",()=>{
 const capture=target.slice(target.indexOf("pub(super) fn capture_window_png("),
  target.indexOf("#[cfg(not(target_os = \"windows\"))]\npub(super) fn capture_window_png("));
 assert.match(capture,/prune_stale_vision_captures\(&dir\)/);
 assert.match(capture,/format!\("vision-\{\}-\{\}\.png"/);
 assert.doesNotMatch(capture,/prune_screenshot_dir\(/);
 const manual=main.slice(main.indexOf("fn capture_screen_png()"),
  main.indexOf("async fn preflight_inspect_screen_vision("));
 assert.match(manual,/format!\("screen-\{\}-\{\}\.png"/);
 assert.doesNotMatch(manual,/prune_stale_vision_captures/);
});
test("stale cleanup is conservative, limited by age, file prefix and directory type",()=>{
 const beg=target.indexOf("fn prune_stale_vision_captures(");
 const end=target.indexOf("pub(super) fn expired_capture_binding(",beg);
 const code=target.slice(beg,end);
 assert.match(code,/Duration::from_secs\(15 \* 60\)/);
 assert.match(code,/fs::read_dir\(dir\)/);
 assert.match(code,/name\.starts_with\("vision-"\)/);
 assert.match(code,/name\.ends_with\("\.png"\)/);
 assert.match(code,/kind\.is_file\(\)/);
 assert.match(code,/duration_since\(modified\)/);
 assert.match(code,/fs::remove_file\(entry\.path\(\)\)/);
 assert.doesNotMatch(code,/remove_dir_all|canonicalize|Command::new|follow_links/);
 for(const name of ["stale_vision_cleanup_never_removes_manual_or_recent_capture_files",
                      "vision_scavenger_wont_remove_nonexistent_directory"])
 assert.ok(target.includes(name));
});
