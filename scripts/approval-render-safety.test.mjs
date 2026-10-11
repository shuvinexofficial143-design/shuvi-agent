import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {approvalRiskClass,validPendingDisplayMetadata} from "../src/approval-render-safety.mjs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const id="123e4567-e89b-42d3-a456-426614174000";
const valid={id,kind:"read_file",summary:"Read a path",detail:"/workspace/file",risk:"low"};
test("native approval fields must be typed, bounded and match exact proposed tool",()=>{
 assert.equal(validPendingDisplayMetadata(valid,"read_file"),true);
 for(const bad of [{id:"invalid"},{risk:"<svg onload=alert(1)>"},{kind:"launch_app"},
   {summary:"\u202eAllow forever"},{detail:"\u0000"},{summary:""},
   {summary:"x".repeat(701)},{detail:"x".repeat(2401)}])
   assert.equal(validPendingDisplayMetadata({...valid,...bad},"read_file"),false);
 assert.equal(approvalRiskClass("low"),"risk low");
 assert.equal(approvalRiskClass("evil onmouseover=alert(1)"),"risk unknown");
});
test("chat and manual approval parse only static markup and set untrusted labels as text",()=>{
 const chat=main.slice(main.indexOf("function renderChatPermission("),main.indexOf("function renderManualPending("));
 const manual=main.slice(main.indexOf("function renderManualPending("),main.indexOf('el<HTMLButtonElement>("#refreshAudit")'));
 assert.match(chat,/chatSummary.textContent = pendingAction.summary/);
 assert.match(manual,/manualSummary.textContent = pendingAction.summary/);
 assert.match(chat,/chatRisk.className = approvalRiskClass\(pendingAction.risk\)/);
 assert.match(manual,/manualRisk.className = approvalRiskClass\(pendingAction.risk\)/);
 const chatMarkup=chat.slice(chat.indexOf("chatPermission.innerHTML ="),chat.indexOf("const chatRisk ="));
 const manualMarkup=manual.slice(manual.indexOf("box.innerHTML ="),manual.indexOf("const manualRisk ="));
 assert.ok(chatMarkup.includes("chatPermission.innerHTML"));
 assert.ok(manualMarkup.includes("box.innerHTML"));
 assert.doesNotMatch(chatMarkup,/pendingAction\.(summary|risk|detail)/);
 assert.doesNotMatch(manualMarkup,/pendingAction\.(summary|risk|detail)/);
 assert.match(main,/validPendingDisplayMetadata\(pendingAction, proposal.tool\)/);
 assert.match(main,/validPendingDisplayMetadata\(pendingAction\)/);
});
test("provider labels are inserted as DOM text, never HTML options",()=>{
 for(const target of ["providerSelect","onboardingProvider","teamRole","teamProvider"])
   assert.ok(main.includes(target+".replaceChildren("));
 assert.doesNotMatch(main,/providerSelect.innerHTML = providers/);
});
