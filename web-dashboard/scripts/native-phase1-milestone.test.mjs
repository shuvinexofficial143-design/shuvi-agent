import test from "node:test";
import assert from "node:assert/strict";
import {actionFingerprint,seenAfterAuditedChange} from "../src/native-action-loop.mjs";
import {verifiedExecutionReceipt,contradictsFailureReceipt} from "../src/native-action-receipts.mjs";
import {newEvidence,recordAuditedEvidence} from "../src/native-task-evidence.mjs";
import {observedWindowInventory,checkObservedMutationTarget,checkAmbiguousReadWindow} from "../src/native-window-target-guard.mjs";
import {checkRequestedAppTarget} from "../src/native-intent-target.mjs";
import {windowGoalEvidence} from "../src/native-goal-evidence.mjs";
import {validPreparedApproval} from "../src/native-prepared-approval.mjs";
import {isAuditedUiReadFailure} from "../src/native-read-recovery.mjs";

const prepared={id:"action-100",kind:"ui_windows",
 summary:"Inspect Windows",detail:"Read-only native inventory",risk:"low"};
const receipt={action_id:"action-100",tool:"ui_windows",event:"executed",success:true};
const raw={tool:"ui_windows",success:true,exit_code:0,stdout:JSON.stringify([
 {Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:100,NativeWindowHandle:500}
])};

test("Batch 100: preparation alone never authorizes or verifies a Windows result",()=>{
 assert.equal(validPreparedApproval(prepared),true);
 assert.equal(verifiedExecutionReceipt(prepared,raw,[]),false);
 assert.equal(verifiedExecutionReceipt(prepared,raw,[receipt]),true);
 assert.equal(verifiedExecutionReceipt(prepared,{...raw,exit_code:1},[receipt]),false);
 assert.equal(verifiedExecutionReceipt(prepared,raw,[receipt,{...receipt,event:"failed",success:false}]),false);
 assert.strictEqual(recordAuditedEvidence(newEvidence(),"action-100",raw,false).audited,0);
});
test("Batch 100: independently audited app window does not imply saved project or edit",()=>{
 const inventory=observedWindowInventory(raw,true);
 assert.equal(inventory.length,1);
 assert.equal(checkObservedMutationTarget({tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026"}},inventory).allowed,true);
 assert.equal(checkObservedMutationTarget({tool:"ui_click",arguments:{window:"Adobe Photoshop 2026"}},inventory).allowed,false);
 assert.equal(checkRequestedAppTarget("Premiere kholo",{tool:"ui_click",arguments:{window:"Adobe Photoshop 2026"}}).allowed,false);
 assert.equal(windowGoalEvidence("Premiere kholo",raw,true)?.app,"premiere");
 assert.equal(windowGoalEvidence("Premiere kholo",raw,false),null);
});
test("Batch 100: UI mutation makes old snapshot stale; no blind find/discover",()=>{
 const inventory=observedWindowInventory(raw,true);
 const read=actionFingerprint({tool:"ui_windows",arguments:{}});
 const mutation=actionFingerprint({tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026",name:"New Project"}});
 const after=seenAfterAuditedChange(new Set([read,mutation]),"ui_click",true);
 assert.equal(after.has(read),false);
 assert.equal(after.has(mutation),true);
 assert.equal(checkObservedMutationTarget({tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026"}},[]).allowed,false);
 assert.equal(checkAmbiguousReadWindow({tool:"ui_find",arguments:{window:"Adobe Premiere Pro 2026"}},[]).allowed,false);
 assert.equal(checkAmbiguousReadWindow({tool:"ui_discover",arguments:{window:"Unknown window"}},inventory).allowed,false);
});
test("Batch 100: failed UI read cannot trigger recovery without exact failed receipt",()=>{
 const id="failed-ui-read";
 const failed={action_id:id,tool:"ui_find",event:"failed",success:false};
 const message="UI lookup failed: control not found";
 assert.equal(isAuditedUiReadFailure("ui_find",message,id,failed),true);
 assert.equal(isAuditedUiReadFailure("ui_find",message,id,{...failed,action_id:"other"}),false);
 assert.equal(contradictsFailureReceipt({id,kind:"ui_find"},[failed]),false);
 assert.equal(contradictsFailureReceipt({id,kind:"ui_find"},[failed,{...failed,event:"executed",success:true}]),true);
});
test("Batch 100: malformed action arguments and invisible approval risks fail before staging",()=>{
 assert.equal(actionFingerprint({tool:"ui_click",arguments:["untrusted"]}),null);
 assert.equal(validPreparedApproval({...prepared,risk:"low\u202eHigh"}),false);
 assert.equal(validPreparedApproval({...prepared,summary:" "}),false);
});
