import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkedNativeCheckpointRevision as checked} from "../src/master-native-checkpoint-cas.mjs";
test("only a host-null or SHA-256 expected revision can enter native CAS",()=>{
 assert.equal(checked(null),null);
 assert.equal(checked("a".repeat(64)),"a".repeat(64));
 for(const bad of [undefined,"",0,false,"F".repeat(64),"1".repeat(63),{},[]])
  assert.throws(()=>checked(bad));
});
test("Frontend uses native conditional save and clear under existing scoped FIFO checkpoint lane",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=ui.indexOf("async function guardedSaveNativeCheckpoint(");
 const end=ui.indexOf("async function saveActiveCheckpoint()",start);
 const b=ui.slice(start,end);
 assert.match(b,/taskCheckpointLane\.enqueue/);
 assert.match(b,/session_checkpoint_snapshot/);
 assert.match(b,/save_session_checkpoint_if_revision/);
 assert.match(b,/clear_session_checkpoint_if_revision/);
 assert.match(b,/expectedRevision:nativeCheckpointRevision/);
 assert.match(b,/if\(!sameOwner\(\)\)throw Error/);
 assert.doesNotMatch(b,/invoke\("save_session_checkpoint"|invoke\("clear_session_checkpoint"/);
});
test("CAS compare/save/readback protects paid provider from another native writer",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const b=ui.slice(ui.indexOf("async function guardedSaveNativeCheckpoint"),
   ui.indexOf("async function guardedClearNativeCheckpoint"));
 const save=b.indexOf('save_session_checkpoint_if_revision');
 const read=b.indexOf('session_checkpoint_snapshot',save);
 const verify=b.indexOf('assessNativeCheckpointReadback(checkpoint,reloaded.checkpoint)',read);
 assert.ok(save>0&&read>save&&verify>read);
 assert.match(b,/reloaded\.revision!==nativeCheckpointRevision/);
});
test("Rust transaction source enforces native OS lock and one expected revision compare",()=>{
 const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 assert.match(lib,/fn session_checkpoint_snapshot\(/);
 assert.match(lib,/fn save_session_checkpoint_if_revision\(/);
 assert.match(lib,/fn clear_session_checkpoint_if_revision\(/);
 assert.match(lib,/current.revision!=expected_revision/);
 const guard=readFileSync(new URL("../src-tauri/src/session_checkpoint_guard.rs",import.meta.url),"utf8");
 assert.match(guard,/handle\.try_lock\(\)/);
});
