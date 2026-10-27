import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const target=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
const core=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("vision screenshot directory refuses redirected managed parent or capture leaf",()=>{
 const begin=target.indexOf("pub(super) fn validate_vision_capture_directory(");
 const end=target.indexOf("fn prune_stale_vision_captures(",begin);
 const validator=target.slice(begin,end);
 assert.ok(begin>0&&end>begin);
 for(const marker of ["dir.parent()","fs::symlink_metadata(path)","meta.file_type().is_symlink()","!meta.is_dir()"])
  assert.ok(validator.includes(marker),marker);
 assert.doesNotMatch(validator,/canonicalize\(|remove_dir_all|read_dir\(|Command::new/);
 const scanner=target.slice(end,target.indexOf("pub(super) struct PreparedCaptureTarget"));
 assert.match(scanner,/validate_vision_capture_directory\(dir\)\?/);
});
test("both window and full-desktop vision reject unsafe folders BEFORE image allocation",()=>{
 const targetStart=target.indexOf("pub(super) fn capture_window_png(");
 const capture=target.slice(targetStart,target.indexOf("let script = r#\"",targetStart));
 const create=capture.indexOf("fs::create_dir_all(&dir)");
 const guard=capture.indexOf("validate_vision_capture_directory(&dir)?",create);
 const path=capture.indexOf("let path = dir.join(",guard);
 assert.ok(create>=0&&guard>create&&path>guard);
 const desktop=core.slice(core.indexOf("fn capture_screen_png_with_mode(ephemeral: bool)"),
  core.indexOf("async fn preflight_inspect_screen_vision("));
 const guard2=desktop.indexOf("validate_vision_capture_directory(&dir)?");
 const path2=desktop.indexOf("let path = dir.join(",guard2);
 const prune=desktop.indexOf("prune_screenshot_dir(");
 assert.ok(guard2>=0&&path2>guard2&&prune>guard2);
 assert.doesNotMatch(desktop,/if ephemeral \{\s*target_window_capture::validate_vision_capture_directory/);
 assert.match(desktop,/if !ephemeral \{\s+let _ = prune_screenshot_dir/);
});
test("Rust tests cover real directories, ordinary files and symlink redirects",()=>{
 for(const token of ["vision_directory_accepts_real_managed_folder",
  "vision_directory_rejects_file_instead_of_folder",
  "vision_directory_rejects_managed_folder_symlink_on_unix"])
  assert.ok(target.includes(token),token);
});

test("Windows directory validator rejects reparse/junction attributes in addition to symlinks",()=>{
 const i=target.indexOf("pub(super) fn validate_vision_capture_directory(");
 const j=target.indexOf("fn is_owned_vision_capture_name(",i);
 const section=target.slice(i,j);
 assert.match(section,/MetadataExt/);
 assert.match(section,/file_attributes\(\) & FILE_ATTRIBUTE_REPARSE_POINT != 0/);
 assert.match(section,/FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400/);
 assert.match(section,/cfg\(target_os = "windows"\)/);
 assert.match(section,/meta\.file_type\(\)\.is_symlink\(\)/);
});
