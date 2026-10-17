import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createMasterFinalizationSingleFlight} from "../src/master-finalization-single-flight.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const scope=()=>({taskId:TASK,revoked:false});
test("double success callbacks cannot finalize or publish two terminal Rust deliveries",()=>{
 const lane=createMasterFinalizationSingleFlight(),owner=scope(),g={objective:"Native task"};
 const original=lane.acquire(owner,g,"Open Premiere");assert.ok(original);
 assert.equal(lane.acquire(owner,g,"Open Premiere"),null);
 assert.equal(lane.acquire(owner,{...g},"Open Premiere"),null);
 assert.equal(lane.acquire(scope(),g,"Another task"),null);
 assert.equal(original.release(),true);
 assert.equal(original.release(),false);
 assert.ok(lane.acquire(owner,g,"Open Premiere"));
});
test("delayed old Rust finalization holds new task until first native completion settles",async()=>{
 const lane=createMasterFinalizationSingleFlight(),old=scope(),graph={revision:1};
 let release;const done=new Promise(r=>release=r);
 const lease=lane.acquire(old,graph,"Goal");assert.ok(lease);
 const first=(async()=>{await done;lease.release()})();
 old.revoked=true;
 assert.equal(lane.acquire(scope(),graph,"New goal"),null);
 release();await first;
 assert.ok(lane.acquire(scope(),graph,"New goal"));
});
test("invalid owner task, foreign UUID and revoked consent never gain finalization permit",()=>{
 const lane=createMasterFinalizationSingleFlight(),g={revision:1};
 for(const [owner,graph,goal] of [
  [null,g,"Goal"],[{taskId:"bad",revoked:false},g,"Goal"],
  [{taskId:TASK,revoked:true},g,"Goal"],[scope(),null,"Goal"],
  [scope(),g,null],[scope(),g,""]
 ]) assert.equal(lane.acquire(owner,graph,goal),null);
});
test("Desktop holds one finalization permit from before scheduler IPC through disk erasure",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=ui.indexOf('if (continuation.mode==="complete")');
 const end=ui.indexOf("A dependency-ready native INSPECTION",start);
 const body=ui.slice(start,end);
 const acquire=body.indexOf("const finalizationFlight=masterFinalizationSingleFlight.acquire");
 const schedule=body.indexOf('invoke<NativeSchedule|null>("native_scheduler_status")',acquire);
 const rust=body.indexOf('invoke<NativeTaskDelivery>("finalize_native_task_delivery"',schedule);
 const terminal=body.indexOf("await closeRemoteTask(terminalStatus)",rust);
 const clear=body.indexOf("await clearActiveCheckpoint(true)",terminal);
 const release=body.indexOf("finalizationFlight.release();",clear);
 assert.ok(acquire>=0&&schedule>acquire&&rust>schedule&&terminal>rust&&clear>terminal&&release>clear);
 assert.match(body,/if\(!finalizationFlight\)return;/);
 assert.match(body,/finally\s*\{\s*finalizationFlight\.release\(\);\s*\}/);
});
test("pure finalization admission does not forge native delivery or bypass high-risk permission",()=>{
 const s=readFileSync(new URL("../src/master-finalization-single-flight.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(s,/invoke\(|execute_action|prepare_tool|grantTaskRead|sha256_verified|originalGoalVerified/);
});
