import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {captureMasterPermissionUiFence as capture,isMasterPermissionUiFenceCurrent as current}
 from "../src/master-permission-ui-fence.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const ACTION="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
function fixture(){
 const scope={taskId:TASK,revoked:false},graph={revision:1},owner="Open Premiere",
  pending={id:ACTION},proposal={tool:"premiere_launch"},remote={task:"mobile"};
 const fence=capture(scope,graph,owner,pending,proposal,remote);
 const state={scope,graph,owner,pending,proposal,remote,cancelRequested:false,mode:"normal"};
 assert.ok(fence);return {fence,state};
}
test("Allow once is valid only for exact old Rust prepared action and owner graph",()=>{
 const {fence,state}=fixture();
 assert.equal(current(fence,state),true);
 assert.equal(Object.isFrozen(fence),true);
 for(const change of [
  {pending:{...state.pending}},{pending:{id:TASK}},{scope:{...state.scope}},
  {graph:{...state.graph}},{owner:"New task"},{proposal:{...state.proposal}},
  {remote:{...state.remote}},{cancelRequested:true},{mode:"stopped"},
  {mode:"replan_required"}
 ])assert.equal(current(fence,{...state,...change}),false);
});
test("reused same UUID in another task-scope object cannot reactivate a stale DOM button",()=>{
 const {fence,state}=fixture(),rotated={...state.scope};
 assert.equal(rotated.taskId,state.scope.taskId);
 assert.equal(current(fence,{...state,scope:rotated}),false);
 state.scope.revoked=true;
 assert.equal(current(fence,state),false);
});
test("no unsafe or unaudited pending identity can capture local UI authority",()=>{
 const {state}=fixture();
 assert.equal(capture(null,state.graph,state.owner,state.pending,state.proposal,null),null);
 assert.equal(capture(state.scope,state.graph,state.owner,{id:"bad"},state.proposal,null),null);
 assert.equal(capture(state.scope,state.graph,state.owner,null,state.proposal,null),null);
 assert.equal(capture({...state.scope,revoked:true},state.graph,state.owner,state.pending,state.proposal,null),null);
});
test("Desktop Allow once, read grant, and Deny do not accept stale callbacks",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const block=ui.slice(ui.indexOf("function renderChatPermission("),ui.indexOf("const masterProviderSingleFlight="));
 assert.match(block,/const uiFence=captureMasterPermissionUiFence\(/);
 assert.match(block,/const uiCurrent=\(\)=>isMasterPermissionUiFenceCurrent\(/);
 assert.match(block,/approve\.onclick = async \(\) => \{\s*if\(!uiCurrent\(\)\)return;/);
 assert.match(block,/allowSession\.onclick = async \(\) => \{\s*if\(!uiCurrent\(\)\)return;/);
 assert.match(block,/if\(!uiCurrent\(\)\)return;\s*await stopAgentForSafety\("Rust refused this read grant/);
 assert.match(block,/deny\.onclick = async \(\) => \{\s*if\(!uiCurrent\(\)\)return;/);
 assert.match(block,/const stillDenied=\(\)=>sameDeniedOwner\(\)&&remoteTask===uiRemote;/);
 assert.match(block,/if\(!stillDenied\(\)\)return;/);
 assert.match(block,/deniedGraph=orchestration\.task_graph;/);
});
test("the owner permission fence never issues a native grant or executes a Windows tool",()=>{
 const m=readFileSync(new URL("../src/master-permission-ui-fence.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(m,/issue_task_read_grant|execute_action|prepare_tool|invoke\(|grantTaskRead/);
});
