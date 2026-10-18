import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const begin=ui.indexOf("async function loadRecoveryCheckpoint()");
const end=ui.indexOf("async function refreshRam()",begin);
const block=ui.slice(begin,end);
test("changed Rust checkpoint revision keeps visible owner-review warning rather than silent no-session",()=>{
 assert.match(block,/nativeCheckpointRevision!==observedRevision/);
 assert.match(block,/Native checkpoint changed in another process; owner review required/);
 const p=block.lastIndexOf("} catch {");
 const error=block.slice(p);
 assert.match(error,/savedCheckpoint = null;/);
 assert.match(error,/resumeSummary\.textContent =/);
 assert.match(error,/Recovery blocked: native checkpoint unavailable or changed/);
 assert.match(error,/resumeBanner\.classList\.remove\("hidden"\)/);
 assert.doesNotMatch(error,/resumeBanner\.classList\.add\("hidden"\)/);
});
test("revision-conflict UI offers no unsafe Resume authority until valid scoped Rust snapshot",()=>{
 const scope=block.indexOf("const stillReading=");
 const snapshot=block.indexOf('invoke<NativeCheckpointSnapshot>("session_checkpoint_snapshot")');
 const compare=block.indexOf("nativeCheckpointRevision!==observedRevision",snapshot);
 const banner=block.indexOf('resumeBanner.classList.remove("hidden")',compare);
 assert.ok(scope>0&&snapshot>scope&&compare>snapshot&&banner>compare);
 assert.doesNotMatch(block,/invoke\("clear_session_checkpoint"|invoke\("save_session_checkpoint"|await runAgentStep\(/);
});
