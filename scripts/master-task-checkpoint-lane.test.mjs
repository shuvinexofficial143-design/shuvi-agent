import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createTaskCheckpointLane} from "../src/master-task-checkpoint-lane.mjs";
const deferred=()=>{let release,reject;const promise=new Promise((yes,no)=>{release=yes;reject=no});return {promise,release,reject};};
test("old in-flight native SAVE cannot overtake a newly queued task snapshot",async()=>{
 const lane=createTaskCheckpointLane(),inFlight=deferred(),started=deferred();
 const events=[];
 const old=lane.enqueue(()=>true,async()=>{events.push("old start");started.release();await inFlight.promise;events.push("old done")});
 await started.promise;
 const newer=lane.enqueue(()=>true,async()=>{events.push("new save")});
 await Promise.resolve();assert.deepEqual(events,["old start"]);
 inFlight.release();
 assert.equal(await old,true);
 assert.equal(await newer,true);
 assert.deepEqual(events,["old start","old done","new save"]);
});
test("rotated owner invalidates queued old SAVE and CLEAR without native disk mutation",async()=>{
 const lane=createTaskCheckpointLane(),gate=deferred(),started=deferred();
 let owner={id:"task A"},calls=0;
 const running=lane.enqueue(()=>true,async()=>{started.release();await gate.promise});
 await started.promise;
 const oldScope=owner;
 const staleSave=lane.enqueue(()=>owner===oldScope,async()=>{calls++});
 const staleClear=lane.enqueue(()=>owner===oldScope,async()=>{calls++});
 owner={id:"task B"};
 const newSave=lane.enqueue(()=>owner.id==="task B",async()=>{calls+=10});
 gate.release();await running;
 assert.equal(await staleSave,false);assert.equal(await staleClear,false);
 assert.equal(await newSave,true);assert.equal(calls,10);
});
test("stale queued jobs cannot revive after same UUID owner/scope is replaced",async()=>{
 const lane=createTaskCheckpointLane(),gate=deferred(),started=deferred();
 let scope={taskId:"repeat"};
 const busy=lane.enqueue(()=>true,async()=>{started.release();await gate.promise});
 await started.promise;
 const bound=scope;
 const stale=lane.enqueue(()=>scope===bound,async()=>{throw Error("Stale write called")});
 scope={taskId:"repeat"};
 gate.release();await busy;
 assert.equal(await stale,false);
});
test("native Rust save rejection is surfaced and does not poison next queued work",async()=>{
 const lane=createTaskCheckpointLane();
 await assert.rejects(lane.enqueue(()=>true,async()=>{throw Error("native IO failure")}),/native IO failure/);
 assert.equal(await lane.enqueue(()=>true,async()=>42),true);
});
test("failed owner check also leaves queue able to accept a newer owner",async()=>{
 const lane=createTaskCheckpointLane();
 await assert.rejects(lane.enqueue(()=>{throw Error("guard unavailable")},async()=>{}),/guard unavailable/);
 let didRun=false;
 assert.equal(await lane.enqueue(()=>true,async()=>{didRun=true}),true);
 assert.equal(didRun,true);
});
test("Desktop source queues every task checkpoint write and clear, no direct concurrent IPC",()=>{
 const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const writer=main.slice(main.indexOf("async function guardedSaveNativeCheckpoint"),
   main.indexOf("async function guardedClearNativeCheckpoint"));
 const clearer=main.slice(main.indexOf("async function guardedClearNativeCheckpoint"),
   main.indexOf("async function saveActiveCheckpoint"));
 assert.match(writer,/structuredClone\(currentCheckpoint\(\)\)/);
 assert.match(writer,/taskCheckpointLane\.enqueue\(/);
 assert.match(writer,/invoke\("save_session_checkpoint",\{checkpoint\}\)/);
 assert.match(writer,/const reloaded=await invoke<SessionCheckpoint\|null>\("load_session_checkpoint"\)/);
 assert.match(clearer,/taskCheckpointLane\.enqueue\(/);
 assert.match(clearer,/invoke\("clear_session_checkpoint"\)/);
 assert.equal((main.match(/invoke\("save_session_checkpoint"/g)||[]).length,1);
 assert.equal((main.match(/invoke\("clear_session_checkpoint"/g)||[]).length,1);
 assert.match(main,/if\(!\(await guardedSaveNativeCheckpoint\(true\)\)\)return;/);
 assert.match(main,/await guardedClearNativeCheckpoint\(clearingScope,clearingGraph,clearingOwner\)/);
});
