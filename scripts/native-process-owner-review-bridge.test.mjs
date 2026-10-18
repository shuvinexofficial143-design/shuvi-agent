import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const worker=readFileSync(new URL("../src-tauri/src/native_worker_job.rs",import.meta.url),"utf8");
const owned=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
test("native dispatch rejects outstanding subprocess intent even with clean main journal",()=>{
  assert.match(worker,/owned_process::require_process_receipt_clear\(app\)\?/);
  assert.match(owned,/receipt\.phase\.as_str\(\),"launch_pending"\|"running"/);
});
test("only owner-reconciled exact native journal identity can review OS process receipt",()=>{
  assert.match(worker,/if existing\.phase!="running"\|\|existing\.action_id!=id\|\|existing\.tool!=tool/);
  assert.match(worker,/owned_process::review_process_receipt_for_owner\(app,id,tool\)\?/);
  assert.match(owned,/Foreign unresolved process receipt cannot be dismissed/);
  assert.doesNotMatch(owned,/tauri::command/);
});
