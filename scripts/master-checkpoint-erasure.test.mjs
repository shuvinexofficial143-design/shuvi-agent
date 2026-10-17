import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isNativeCheckpointAbsent} from "../src/master-checkpoint-absent.mjs";
import {createTaskCheckpointLane} from "../src/master-task-checkpoint-lane.mjs";
const source=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const pause=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test("ONLY explicit null Rust native checkpoint is valid erasure proof",()=>{
 assert.equal(isNativeCheckpointAbsent(null),true);
 for(const v of [undefined,false,true,0,"",{},[],{version:2,updated_at_ms:1}])
  assert.equal(isNativeCheckpointAbsent(v),false);
});
test("native terminal cleanup keeps delete+readback in same serialized lane operation",()=>{
 const start=source.indexOf("async function guardedClearNativeCheckpoint(");
 const end=source.indexOf("async function saveActiveCheckpoint()",start);
 const block=source.slice(start,end);
 const clear=block.indexOf('await invoke("clear_session_checkpoint")');
 const read=block.indexOf('await invoke<SessionCheckpoint|null>("load_session_checkpoint")',clear);
 const compare=block.indexOf("if(!isNativeCheckpointAbsent(observed))",read);
 assert.ok(clear>=0&&read>clear&&compare>read);
 assert.match(block,/taskCheckpointLane\.enqueue\(/);
 assert.match(block,/verifyReadback/);
});
test("queued new task save never overtakes still-running terminal clear-readback",async()=>{
 const lane=createTaskCheckpointLane(),gate=pause(),begun=pause(),events=[];
 const clearing=lane.enqueue(()=>true,async()=>{
  events.push("old clear");begun.resolve();await gate.promise;
  events.push("old disk readback");
  if(!isNativeCheckpointAbsent(null))throw Error("erasure");
 });
 await begun.promise;
 const newTask=lane.enqueue(()=>true,async()=>{events.push("new task save")});
 await Promise.resolve();
 assert.deepEqual(events,["old clear"]);
 gate.resolve();assert.equal(await clearing,true);assert.equal(await newTask,true);
 assert.deepEqual(events,["old clear","old disk readback","new task save"]);
});
test("failed checkpoint erase verification blocks success cleanup without poisoning the queue",async()=>{
 const lane=createTaskCheckpointLane();
 await assert.rejects(lane.enqueue(()=>true,async()=>{
  if(!isNativeCheckpointAbsent({version:2}))throw Error("old checkpoint remains");
 }),/old checkpoint remains/);
 assert.equal(await lane.enqueue(()=>true,async()=>{}),true);
});
test("verified native completion cannot mark local idle after an unconfirmed Rust erase",()=>{
 const terminal=source.slice(source.indexOf("async function continueAfterOutcome"),source.indexOf("async function stageProposal"));
 const verify=terminal.indexOf("const checkpointErased=await clearActiveCheckpoint(true);");
 const notClear=terminal.indexOf("if(!checkpointErased){",verify);
 const stop=terminal.indexOf("Native task delivery was verified, but Rust checkpoint deletion",notClear);
 const last=terminal.indexOf("setBusy(false);",stop);
 assert.ok(verify>=0&&notClear>verify&&stop>notClear&&last>stop);
 assert.match(terminal,/const terminalStillOwned=\(\)=>activePermissionScope===continuationScope/);
});
test("ordinary best effort cleanup remains optional; terminal branch requires native erase readback",()=>{
 const start=source.indexOf("async function clearActiveCheckpoint(");
 const end=source.indexOf("async function loadRecoveryCheckpoint",start);
 const helper=source.slice(start,end);
 assert.match(helper,/verifyReadback=false/);
 assert.match(helper,/return await guardedClearNativeCheckpoint\(clearingScope,clearingGraph,clearingOwner,verifyReadback\)/);
 const terminal=source.slice(source.indexOf("async function continueAfterOutcome"),source.indexOf("async function stageProposal"));
 assert.match(terminal,/await clearActiveCheckpoint\(true\)/);
});
