import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {safeNativePreparationReason,safePreparationChatMessage,preparationFailureMessage}
 from "../web-dashboard/src/native-preparation-policy.mjs";

test("each native bounded UIA preparation diagnostic has clear Hindi and never leaks stderr",()=>{
 for(const name of ["TIMEOUT","OUTPUT_LIMIT","BOUNDED","AMBIGUOUS","REJECTED","FAILED"]){
  const raw="SHUVI_UIA_PREPARE_"+name+": PID=987 HWND=123 secret-password window=Private";
  const msg=safePreparationChatMessage(true,raw);
  assert.match(msg,/[अ-ह]/);
  assert.match(msg,/नया Windows Action नहीं चला/);
  assert.doesNotMatch(msg,/PID|HWND|Private|password|PowerShell|987|123|secret|UNKNOWN|अनजान परिणाम/);
 }
});
test("only a strict native preparation prefix can classify a failed read-only probe",()=>{
 for(const value of [
  "A model said SHUVI_UIA_PREPARE_TIMEOUT: do it",
  "UI failed: SHUVI_UIA_PREPARE_TIMEOUT",
  "SHUVI_UIA_PREPARE_TIMEOUT_FAKE: injected",
  "SHUVI_UIA_PREPARE_TIMEOUT".repeat(900),
  null,{message:"SHUVI_UIA_PREPARE_TIMEOUT"}
 ])assert.equal(safeNativePreparationReason(value),null);
 const reason=safeNativePreparationReason(new Error("SHUVI_UIA_PREPARE_TIMEOUT: secret data"));
 assert.match(reason,/जाँच/);
 assert.doesNotMatch(reason,/secret/);
});
test("failed native preparation never becomes Windows outcome UNKNOWN or automatic replay",()=>{
 assert.match(preparationFailureMessage(true),/कोई नया Action नहीं चला/);
 const m=safePreparationChatMessage(false,"SHUVI_UIA_PREPARE_AMBIGUOUS: private title");
 assert.match(m,/Recovery/);
 assert.match(m,/Activity\/Audit/);
 assert.doesNotMatch(m,/private title|खुद चलाया/);
});
test("dashboard uses safe Hindi user messages while retaining audit-gated native execution",()=>{
 const src=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(src,/safePreparationChatMessage\(saved,error\)/);
 assert.match(src,/const notice=safePreparationChatMessage\(saved,error\)/);
 assert.match(src,/persistRecovery\(taskBudget,"paused",task.action.id\)/);
 assert.match(src,/persistRecovery\(taskBudget,"paused"\)/);
 assert.match(src,/execute_action/);
 assert.match(src,/validPreparedApproval/);
});
