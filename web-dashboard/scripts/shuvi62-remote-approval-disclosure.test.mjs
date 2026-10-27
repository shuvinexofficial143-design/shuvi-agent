import test from "node:test";
import assert from "node:assert/strict";
import {remoteApprovalDisclosure} from "../src/remote-approval-disclosure.mjs";
import {validateTaskReceipt,validateApprovalBinding,REMOTE_PROTOCOL} from "../src/remote-command-contract.mjs";
const id="z".repeat(32),owner="o".repeat(32),device="d".repeat(32);
const prepared={id,kind:"ui_click",risk:"medium",summary:"Click observed control",detail:"private command never sent"};
const proposal={tool:"ui_click",arguments:{window:"Adobe Premiere Pro",name:"Export"}};
test("BUG-020: server-mobile disclosure binds the native action UUID and no arbitrary detail",()=>{
 const action=remoteApprovalDisclosure(prepared,proposal);
 assert.deepEqual(action,{id,tool:"ui_click",risk:"medium",summary:"Click observed control",target:"window: Adobe Premiere Pro"});
 assert.doesNotMatch(JSON.stringify(action),/private command never sent/);
});
test("BUG-020: malformed target or shell command cannot be remote-approved",()=>{
 assert.equal(remoteApprovalDisclosure({...prepared,id:"bad"},proposal),null);
 assert.equal(remoteApprovalDisclosure(prepared,{...proposal,tool:"ui_set_value"}),null);
 assert.equal(remoteApprovalDisclosure(prepared,{tool:"ui_click",arguments:{window:"A\u202eevil"}}),null);
 assert.equal(remoteApprovalDisclosure({...prepared,kind:"powershell"},{tool:"powershell",arguments:{command:"password"}}),null);
 assert.equal(remoteApprovalDisclosure({...prepared,summary:"X".repeat(300)},proposal),null);
});
test("BUG-020: no approvals without bound action metadata or correct action ID",()=>{
 const approvalAction=remoteApprovalDisclosure(prepared,proposal),now=1791540000000;
 const pending={protocol:REMOTE_PROTOCOL,type:"task_receipt",ownerId:owner,deviceId:device,
  threadId:"t".repeat(32),messageId:"m".repeat(32),taskId:"q".repeat(32),
  revision:3,occurredAt:now,status:"requires_approval",approvalId:"a".repeat(32),
  approvalExpiresAt:now+90000,approvalAction};
 assert.equal(validateTaskReceipt(pending).ok,true);
 assert.equal(validateTaskReceipt({...pending,approvalAction:null}).error,"approval_requires_action_disclosure");
 const context={now:now+1000,ownerId:owner,deviceId:device,consumedApprovalIds:new Set()};
 const decision={approvalId:pending.approvalId,actionId:id,taskId:pending.taskId,
  ownerId:owner,deviceId:device,decision:"approve"};
 assert.equal(validateApprovalBinding(decision,pending,context).ok,true);
 assert.equal(validateApprovalBinding({...decision,actionId:"y".repeat(32)},pending,context).error,"approval_binding_mismatch");
 assert.equal(validateApprovalBinding({...decision,actionId:undefined},pending,context).error,"invalid_approval_request");
});
