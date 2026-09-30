import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const captions=readFileSync(new URL("../integrations/premiere-uxp/caption-workflows.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const acceptance=readFileSync(new URL("../src-tauri/src/premiere_acceptance.rs",import.meta.url),"utf8");

test("caption source import is native project-item import with explicit timeline-write boundary",()=>{
  const body=uxp.slice(uxp.indexOf("async function importCaptionSource"),uxp.indexOf("function normalizeMediaPath"));
  assert.match(body,/\.\(\?:srt\|vtt\)/i);
  assert.match(body,/project\.importFiles/);
  assert.match(body,/findClipItemsForPaths/);
  assert.match(body,/verified_caption_source_import/);
  assert.match(body,/captionTrackCreated:false/);
  assert.match(body,/captionTextWriteSupported:false/);
  assert.match(captions,/native_project_item_source_import/);
  assert.match(rust,/premiere_import_caption_source/);
  assert.match(acceptance,/"caption_track_text_write":\{"state":"unsupported_documented"/);
});
