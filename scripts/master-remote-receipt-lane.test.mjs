import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createMasterRemoteReceiptLane} from "../src/master-remote-receipt-lane.mjs";
const defer=()=>{let release;const promise=new Promise(resolve=>{release=resolve});return {promise,release};};
const newTask=()=>({revision:0,status:"admitted",message:{taskId:"mobile-A"}});
test("remote admitted/running/approval/final receipts send exact monotonic revision in order",async()=>{
 const lane=createMasterRemoteReceiptLane(),task=newTask(),revisions=[];
 let current=task;
 for(const status of ["running","requires_approval","outcome_unknown"]){
  assert.equal(await lane.publish(task,t=>t===current,async revision=>{revisions.push(revision)},status),true);
 }
 assert.deepEqual(revisions,[1,2,3]);assert.equal(task.revision,3);
 assert.equal(task.status,"outcome_unknown");
});
test("in-flight old remote receipt cannot update newly admitted remote task",async()=>{
 const lane=createMasterRemoteReceiptLane(),gate=defer(),started=defer();
 const old=newTask(),newer={revision:0,status:"admitted"},events=[];
 let current=old;
 const first=lane.publish(old,t=>current===t,async revision=>{
  started.release();events.push("old "+revision);await gate.promise;
 },"running");
 await started.promise;
 const stale=lane.publish(old,t=>current===t,async()=>events.push("stale"),"stopped");
 current=newer;
 const next=lane.publish(newer,t=>current===t,async revision=>events.push("new "+revision),"running");
 gate.release();
 assert.equal(await first,false);assert.equal(await stale,false);
 assert.equal(await next,true);assert.equal(old.revision,0);assert.equal(newer.revision,1);
 assert.deepEqual(events,["old 1","new 1"]);
});
test("two rapid remote receipts cannot claim same monotonically increasing backend revision",async()=>{
 const lane=createMasterRemoteReceiptLane(),t=newTask(),sent=[];
 const [a,b]=await Promise.all([
  lane.publish(t,()=>true,async n=>{sent.push(n)},"running"),
  lane.publish(t,()=>true,async n=>{sent.push(n)},"requires_approval")
 ]);
 assert.deepEqual([a,b],[true,true]);
 assert.deepEqual(sent,[1,2]);
 assert.equal(t.revision,2);
});
test("remote endpoint rejection is not swallowed by success state or queue poisoning",async()=>{
 const lane=createMasterRemoteReceiptLane(),t=newTask();
 await assert.rejects(lane.publish(t,()=>true,async()=>{throw Error("remote denied")},"running"),/remote denied/);
 assert.equal(t.revision,0);
 assert.equal(await lane.publish(t,()=>true,async()=>{},"outcome_unknown"),true);
 assert.equal(t.revision,1);
});
test("malformed inputs and status never publish a remote success",async()=>{
 const lane=createMasterRemoteReceiptLane(),t=newTask();
 await assert.rejects(lane.publish(t,()=>true,async()=>{},"invented_status"),TypeError);
 await assert.rejects(lane.publish({revision:-1},()=>true,async()=>{},"running"),TypeError);
 assert.equal(t.revision,0);
});
test("Desktop all mobile receipts use exact pinned task, and late finish does not clear newer inbox task",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(src,/const remoteReceiptLane=createMasterRemoteReceiptLane\(\)/);
 assert.match(src,/return remoteReceiptLane\.publish\(exactTask,/);
 assert.match(src,/if\(remoteTask!==closingTask\)return;/);
 assert.match(src,/const continuationRemote=remoteTask;/);
 assert.match(src,/remoteTask===continuationRemote;/);
 assert.match(src,/const stagingRemote=remoteTask;/);
 assert.match(src,/const actionRemoteTask=remoteTask;/);
 assert.match(src,/remoteTask===actionRemoteTask&&isNativeActionOwnershipCurrent/);
 assert.match(src,/const requestRemote=remoteTask;/);
 assert.match(src,/remoteTask!==requestRemote/);
});
test("remote receipt lane cannot authorize native high-risk tools or infer creative quality",()=>{
 const m=readFileSync(new URL("../src/master-remote-receipt-lane.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(m,/prepare_tool|execute_action|grantTaskRead|invoke\(|originalGoalVerified:true/);
});
