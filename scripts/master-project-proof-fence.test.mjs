import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {captureNativeProjectProofFence,isNativeProjectProofFenceCurrent} from "../src/master-project-proof-fence.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const OTHER="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const ACTION="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const OWNER="Premiere me naya project banao";
function fixture(){
 const scope={taskId:TASK,revoked:false};
 const graph={objective:OWNER,revision:1,steps:[]};
 const fence=captureNativeProjectProofFence(scope,graph,OWNER,ACTION);
 const current={scope,graph,ownerRequest:OWNER,actionId:ACTION,
  cancelRequested:false,recoveryMode:"normal"};
 assert.ok(fence);return {scope,graph,fence,current};
}
test("only exact original task may consume an async readback",()=>{
 const x=fixture();
 assert.equal(isNativeProjectProofFenceCurrent(x.fence,x.current),true);
 assert.equal(Object.isFrozen(x.fence),true);
});
test("Stop, scope revocation and stopped recovery invalidate late SHA callbacks",()=>{
 const x=fixture();x.current.cancelRequested=true;
 assert.equal(isNativeProjectProofFenceCurrent(x.fence,x.current),false);
 x.current.cancelRequested=false;x.scope.revoked=true;
 assert.equal(isNativeProjectProofFenceCurrent(x.fence,x.current),false);
 x.scope.revoked=false;x.current.recoveryMode="stopped";
 assert.equal(isNativeProjectProofFenceCurrent(x.fence,x.current),false);
});
test("new task scope, restored graph, foreign action and owner never inherit proof",()=>{
 const x=fixture();
 for(const overrides of [
  {scope:{...x.scope}},{graph:{...x.graph}},
  {ownerRequest:"new project"},{actionId:OTHER}
 ])assert.equal(isNativeProjectProofFenceCurrent(x.fence,{...x.current,...overrides}),false);
 x.scope.taskId=OTHER;
 assert.equal(isNativeProjectProofFenceCurrent(x.fence,x.current),false);
});
test("no fence for invalid identity, revoked permission or missing graph",()=>{
 const x=fixture();
 assert.equal(captureNativeProjectProofFence(null,x.graph,OWNER,ACTION),null);
 assert.equal(captureNativeProjectProofFence({taskId:"bad"},x.graph,OWNER,ACTION),null);
 assert.equal(captureNativeProjectProofFence({taskId:TASK,revoked:true},x.graph,OWNER,ACTION),null);
 assert.equal(captureNativeProjectProofFence(x.scope,null,OWNER,ACTION),null);
 assert.equal(captureNativeProjectProofFence(x.scope,x.graph,"",ACTION),null);
 assert.equal(captureNativeProjectProofFence(x.scope,x.graph,OWNER,"bad"),null);
});
test("Desktop gates SHA completion/failure and final delivery by live task identity",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(src,/const actionProofFence=protectProjectProof/);
 assert.match(src,/const postAuditProofFence=protectProjectProof/);
 assert.ok((src.match(/if\(proofFenceCurrent\(postAuditProofFence\)&&/g)||[]).length>=4);
 assert.match(src,/const continuationCurrent=\(\)=>continuationScope===activePermissionScope/);
 assert.ok((src.match(/if\(!continuationCurrent\(\)\)return;/g)||[]).length>=4);
 assert.match(src,/await stopAgentForSafety\(summarizeMasterMissingProof\(finalOutcome\)\)/);
});
