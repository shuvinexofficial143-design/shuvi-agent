import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifiedNativeActionResult,confirmedNativeActionFailure} from "../src/native-action-outcome.mjs";
const ID="123e4567-e89b-42d3-a456-426614174000", OTHER="123e4567-e89b-42d3-a456-426614174001";
const result={tool:"read_file",success:true,stdout:"content",stderr:"",exit_code:null};
const receipt={action_id:ID,tool:"read_file",event:"executed",success:true};
test("a native action is trusted only with exact UUID, tool, and typed audit result",()=>{
 assert.equal(verifiedNativeActionResult("read_file",ID,result,receipt),true);
 assert.equal(verifiedNativeActionResult("read_file",OTHER,result,receipt),false);
 assert.equal(verifiedNativeActionResult("read_file",ID,result,{...receipt,tool:"launch_app"}),false);
 assert.equal(verifiedNativeActionResult("read_file",ID,{...result,tool:"launch_app"}, {...receipt,tool:"launch_app"}),false);
 assert.equal(verifiedNativeActionResult("read_file",ID,result,{...receipt,event:"failed"}),false);
 assert.equal(verifiedNativeActionResult("read_file",ID,{...result,success:false},receipt),false);
 assert.equal(verifiedNativeActionResult("read_file",ID,{...result,exit_code:"0"},receipt),false);
 assert.equal(verifiedNativeActionResult("read_file",ID,result,null),false);
 assert.equal(verifiedNativeActionResult("read_file",ID,{...result,success:false},{...receipt,success:false}),true);
 assert.equal(verifiedNativeActionResult("run_project_task",ID,{...result,tool:"run_project_task",exit_code:1}, {...receipt,tool:"run_project_task"}),false);
});
test("a thrown execution request can replan only after an exact Rust failed receipt",()=>{
 assert.equal(confirmedNativeActionFailure("read_file",ID,{...receipt,event:"failed",success:false}),true);
 assert.equal(confirmedNativeActionFailure("read_file",ID,receipt),false);
 assert.equal(confirmedNativeActionFailure("read_file",ID,{...receipt,action_id:OTHER,event:"failed",success:false}),false);
 assert.equal(confirmedNativeActionFailure("read_file",ID,{...receipt,tool:"launch_app",event:"failed",success:false}),false);
});
test("legacy execution stops without another model call on audit mismatch or unknown error",()=>{
 const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=main.indexOf("async function executePendingProposal(");
 const end=main.indexOf("function renderChatPermission(",start);
 const block=main.slice(start,end);
 assert.match(block,/verifiedNativeActionResult\(proposal.tool, actionId, result, receipt\)/);
 assert.match(block,/if \(!receiptMatches\) \{[\s\S]*?closeRemoteTask\("outcome_unknown"\)[\s\S]*?stopAgentForSafety/);
 assert.match(block,/if \(cancelledByUser \|\| !confirmedFailure\) \{[\s\S]*?stopAgentForSafety/);
 assert.ok(block.indexOf("if (!receiptMatches)")<block.indexOf("messages.push(toolResultMessage(result))"));
 assert.ok(block.indexOf("await continueAfterOutcome();")>block.indexOf("messages.push(toolResultMessage(result))"));
 assert.match(block,/retry_automatically: false/);
 assert.match(block,/confirmedNativeActionFailure\(proposal.tool, actionId, receipt\)/);
 assert.doesNotMatch(block,/error: String\(error\)/);
});
