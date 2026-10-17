import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {captureNativeActionOwnership,isNativeActionOwnershipCurrent}
 from "../src/master-native-action-ownership.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const ACTION="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const FOREIGN="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
function fixture(graph={steps:[]},ownerRequest="Inspect native workspace"){
 const scope={taskId:TASK,revoked:false};
 const lease=captureNativeActionOwnership(scope,graph,ownerRequest,ACTION);
 const now={scope,graph,ownerRequest,actionId:ACTION,
  cancelRequested:false,recoveryMode:"normal"};
 assert.ok(lease);return {scope,lease,now};
}
test("native Premiere, Blender, browser, git and window tool callbacks share exact owner scope protection",()=>{
 const {lease,now}=fixture();
 assert.equal(isNativeActionOwnershipCurrent(lease,now),true);
 assert.equal(Object.isFrozen(lease),true);
});
test("blank graph/no provider brief still allows bounded native action bookkeeping",()=>{
 const {lease,now}=fixture(null,null);
 assert.equal(isNativeActionOwnershipCurrent(lease,now),true);
 assert.equal(captureNativeActionOwnership(null,null,null,ACTION),null);
 assert.equal(captureNativeActionOwnership({taskId:"bad",revoked:false},null,null,ACTION),null);
 assert.equal(captureNativeActionOwnership(now.scope,null,null,"bad"),null);
});
test("new task, even with replayed same UUID, old DAG, action, Stop or owner change cannot accept a late receipt",()=>{
 const {lease,now,scope}=fixture();
 for(const change of [
  {scope:{...scope}},{graph:{steps:[]}},{ownerRequest:"Create a new project"},
  {actionId:FOREIGN},{cancelRequested:true},{recoveryMode:"stopped"}
 ])assert.equal(isNativeActionOwnershipCurrent(lease,{...now,...change}),false);
 scope.taskId=FOREIGN;
 assert.equal(isNativeActionOwnershipCurrent(lease,now),false);
});
test("failed native result can be classified after same task scope revocation but never after Stop/rotation",()=>{
 const {lease,now,scope}=fixture();
 scope.revoked=true;
 assert.equal(isNativeActionOwnershipCurrent(lease,now),false);
 assert.equal(isNativeActionOwnershipCurrent(lease,now,true),true);
 assert.equal(isNativeActionOwnershipCurrent(lease,{...now,cancelRequested:true},true),false);
 assert.equal(isNativeActionOwnershipCurrent(lease,{...now,scope:{...scope}},true),false);
});
test("post-outcome graph revision gets a NEW fence; old fence cannot mutate the next DAG",()=>{
 const {lease,now}=fixture();
 const next={revision:2,steps:[{status:"completed"}]};
 assert.equal(isNativeActionOwnershipCurrent(lease,{...now,graph:next}),false);
 const post=captureNativeActionOwnership(now.scope,next,now.ownerRequest,ACTION);
 assert.ok(post);
 assert.equal(isNativeActionOwnershipCurrent(post,{...now,graph:next}),true);
 assert.equal(isNativeActionOwnershipCurrent(post,{...now,graph:{...next}}),false);
});
test("simulated delayed native success and failure are refused after owner rotation",async()=>{
 const {lease,now}=fixture();
 let release;
 const promise=new Promise(resolve=>release=resolve);
 const task=(async()=>{await promise;return isNativeActionOwnershipCurrent(lease,now)})();
 now.scope={...now.scope};
 release();
 assert.equal(await task,false);
});
test("Desktop execution, error receipt and Rust audit await have universal task ownership gates",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(ui,/const actionOwnership=captureNativeActionOwnership\(/);
 assert.match(ui,/if\(!nativeActionCurrent\(actionOwnership\)\)return;/);
 assert.match(ui,/const postOutcomeOwnership=captureNativeActionOwnership\(/);
 assert.match(ui,/if\(remoteTask!==actionRemoteTask\|\|!isNativeActionOwnershipCurrent\(postOutcomeOwnership,/);
 assert.match(ui,/const failedOutcomeOwnership=captureNativeActionOwnership\(/);
 assert.match(ui,/if\(remoteTask!==actionRemoteTask\|\|!isNativeActionOwnershipCurrent\(failedOutcomeOwnership,/);
 assert.match(ui,/const continuationCurrent=\(\)=>continuationOwnerCurrent\(\)&&[\s\S]{0,150}orchestration\.recovery_mode!=="stopped"/);
 assert.match(ui,/if\(orchestration\.recovery_mode==="stopped"\)\{/);
 assert.match(ui,/if\(!stillStopping\(\)\)return;/);
 assert.match(ui,/const stoppingScope=activePermissionScope;/);
 assert.match(ui,/if\(protectProjectProof&&!proofFenceCurrent\(postAuditProofFence\)\)return;/);
});
test("there is no owner-approved high-risk tool bypass in generic lease logic",()=>{
 const source=readFileSync(new URL("../src/master-native-action-ownership.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/invoke\(|grantTaskRead|execute_action\(|prepare_action\(/);
 const rust=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
 assert.match(rust,/"premiere_create_project"\s*=>\s*"premiere_project"/);
 assert.match(rust,/check_artifact\(a,&step.tool\)/);
 assert.match(rust,/entry.tool!=step.tool\|\|entry.event!="executed"\|\|!entry.success/);
});

test("legitimate same-task audited failure can transition to safe replan without discarding its receipt",()=>{
 const {lease,now}=fixture();
 const replanned={...now,recoveryMode:"replan_required"};
 assert.equal(isNativeActionOwnershipCurrent(lease,replanned),false);
 assert.equal(isNativeActionOwnershipCurrent(lease,replanned,false,true),true);
 const halted={...now,recoveryMode:"stopped"};
 assert.equal(isNativeActionOwnershipCurrent(lease,halted,false,true),true);
 assert.equal(isNativeActionOwnershipCurrent(lease,{...replanned,cancelRequested:true},false,true),false);
 assert.equal(isNativeActionOwnershipCurrent(lease,{...replanned,scope:{...now.scope}},false,true),false);
});
