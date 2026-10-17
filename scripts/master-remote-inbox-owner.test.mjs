import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {captureRemoteInboxOwner as capture,isRemoteInboxOwnerCurrent as isCurrent}
 from "../src/master-remote-inbox-owner.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
function fixture(){
 const scope={taskId:TASK},task={message:{taskId:"mobile-task-1"}},owner="Open Premiere";
 const lease=capture(scope,owner,task);assert.ok(lease);
 return {lease,state:{scope,owner,task,enabled:true}};
}
test("exact Mobile task and permission-scope object own asynchronous outbound inbox reply",()=>{
 const {lease,state}=fixture();
 assert.equal(isCurrent(lease,state),true);
 assert.equal(Object.isFrozen(lease),true);
});
test("replayed UUID, another mobile task, owner change or disabled agent rejects old inbox",()=>{
 const {lease,state}=fixture();
 for(const d of [
  {scope:{...state.scope}},{owner:"Run unrelated Blender job"},
  {task:{...state.task}},{task:null},{enabled:false}
 ])assert.equal(isCurrent(lease,{...state,...d}),false);
 state.scope.taskId="7d635de7-8d29-4205-adac-a45254878631";
 assert.equal(isCurrent(lease,state),false);
});
test("new task admission is a distinct object fence and cannot reuse old task's reply",async()=>{
 const scope={taskId:TASK},task=null,owner=null;
 const lease=capture(scope,owner,task);
 let now={scope,owner,task,enabled:true};
 let release;
 const delayed=new Promise(x=>release=x);
 const inFlight=(async()=>{await delayed;return isCurrent(lease,now)})();
 now={...now,task:{message:{taskId:"new"}},scope:{taskId:TASK}};
 release();
 assert.equal(await inFlight,false);
});
test("invalid identity and overlong brief never create authority",()=>{
 assert.equal(capture(null,null,null),null);
 assert.equal(capture({taskId:""},null,null),null);
 assert.equal(capture({taskId:TASK},"x".repeat(2501),null),null);
});
test("all Remote Inbox await paths maintain original mobile owner identity and admission guards",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=src.indexOf("async function tickRemoteAgent()");
 const end=src.indexOf("void boot();",start),body=src.slice(start,end);
 assert.match(body,/const inboxFence=captureRemoteInboxOwner\(/);
 assert.match(body,/if\(!inboxCurrent\(\)\)return;/);
 assert.match(body,/cancelRequested=true;\s*revokeTaskScope\(activePermissionScope\)/);
 assert.match(body,/if\(!inboxCurrent\(\)\)return;\s*await closeRemoteTask\("stopped"\)/);
 assert.match(body,/remoteApproval!==a\|\|\s*pendingAction\?\.id!==a\.actionId/);
 assert.match(body,/const admittedTask=remoteTask;/);
 assert.match(body,/activePermissionScope!==admissionScope/);
 assert.match(body,/closeRemoteTask\("outcome_unknown"\)/);
});
test("remote inbox source cannot bypass an explicit Rust owner-approved native action",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const area=src.slice(src.indexOf("async function tickRemoteAgent"),src.indexOf("void boot();"));
 assert.match(area,/await executePendingProposal\(a\.proposal\)/);
 assert.doesNotMatch(area,/invoke\("execute_action"/);
});
