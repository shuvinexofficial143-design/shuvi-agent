import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createTaskCheckpointLane} from "../src/master-task-checkpoint-lane.mjs";
import {assessNativeCheckpointReadback} from "../src/master-task-checkpoint-readback.mjs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const def=()=>{let go;const promise=new Promise(x=>go=x);return {promise,go};};
test("save/clear native checkpoint IPC remains ordered before recovery-banner load",async()=>{
 const lane=createTaskCheckpointLane(),wait=def(),started=def(),events=[];
 const write=lane.enqueue(()=>true,async()=>{events.push("write start");started.go();await wait.promise;events.push("write finished")});
 await started.promise;
 const read=lane.enqueue(()=>true,async()=>events.push("read"));
 await Promise.resolve();assert.deepEqual(events,["write start"]);
 wait.go();await write;await read;
 assert.deepEqual(events,["write start","write finished","read"]);
});
test("queued Resume read cannot resurrect old task when owner already discarded checkpoint",async()=>{
 const lane=createTaskCheckpointLane(),wait=def(),started=def(),events=[];
 let selected={id:"saved"};
 const active=lane.enqueue(()=>true,async()=>{started.go();await wait.promise});
 await started.promise;
 const original=selected;
 const late=lane.enqueue(()=>selected===original,async()=>events.push("resume read"));
 selected=null;wait.go();
 await active;assert.equal(await late,false);assert.deepEqual(events,[]);
});
test("only exact restored state and original reserved count may be used after fresh native disk readback",()=>{
 const original={version:2,updated_at_ms:1700000000001,
  provider:"api",model:"master",base_url:null,messages:[{role:"user",content:"Open Premiere"}],
  orchestration:{version:5,owner_request:"Open Premiere",task_graph:null,
   next_step:1,model_requests_reserved:1},worker_models:{}};
 assert.equal(assessNativeCheckpointReadback(original,structuredClone(original)).verified,true);
 const newer=structuredClone(original);newer.orchestration.model_requests_reserved++;
 assert.equal(assessNativeCheckpointReadback(original,newer).verified,false);
});
test("Resume native preflight is after owner confirmation and before restoring task state/AI dispatch",()=>{
 const start=ui.indexOf('el<HTMLButtonElement>("#resumeTask")');
 const block=ui.slice(start,ui.indexOf('el<HTMLButtonElement>("#reviewNativeJob")',start));
 const confirm=block.indexOf('window.confirm(');
 const exact=block.indexOf('assessNativeCheckpointReadback(checkpoint,onDisk)');
 const rotate=block.indexOf('rotatePermissionScope();');
 const run=block.indexOf('await runAgentStep();');
 assert.ok(confirm>=0&&exact>confirm&&rotate>exact&&run>rotate);
 assert.match(block,/if\(!accepted\|\|savedCheckpoint!==checkpoint\|\|busy\)return;/);
 assert.match(block,/if\(!readback\.verified\)\{/);
 assert.match(block,/if\(restored\.recovery_mode!=="stopped"\)\{/);
 assert.match(block,/Stopped checkpoints remain inspection-only/);
});
test("recover banner native read is serialized and bound to exact owner identity",()=>{
 const block=ui.slice(ui.indexOf("async function loadRecoveryCheckpoint"),
  ui.indexOf("async function refreshRam"));
 assert.match(block,/const stillReading=\(\)=>readingScope===activePermissionScope/);
 assert.match(block,/taskCheckpointLane\.enqueue\(stillReading,async\(\)=>\{/);
 assert.match(block,/if\(!accepted\|\|!stillReading\(\)\)return;/);
});
test("Resume never grants read consent from a persisted checkpoint",()=>{
 const start=ui.indexOf('el<HTMLButtonElement>("#resumeTask")');
 const block=ui.slice(start,ui.indexOf('el<HTMLButtonElement>("#reviewNativeJob")',start));
 assert.match(block,/rotatePermissionScope\(\); \/\/ Restoring progress never restores permission grants/);
 assert.doesNotMatch(block,/grantTaskRead\(|authorize_native_action\(/);
});
