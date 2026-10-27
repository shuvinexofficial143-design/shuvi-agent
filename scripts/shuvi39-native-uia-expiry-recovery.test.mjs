import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {auditedNativeUiaExpiry} from "../web-dashboard/src/native-uia-expiry-recovery.mjs";
const A="07db9f20-f9e9-475d-aaba-3ccb141c0e8d";
const ERR="Error: Prepared action expired before execution and must be prepared again.";
const denied={action_id:A,event:"denied",tool:"ui_click",success:false};
const check=(trail=[denied],tool="ui_click",msg=ERR,id=A)=>
 auditedNativeUiaExpiry(id,tool,msg,trail);

test("native Rust expired action is a confirmed nonexecution only with exact denied audit",()=>{
 assert.equal(check(),true);
 assert.equal(check([{...denied},{action_id:A,event:"prepared",tool:"ui_click",success:true}]),true);
});
test("error text alone or model narrative can never claim safe expiry",()=>{
 assert.equal(check([]),false);
 assert.equal(check([denied],"ui_click","Native action outcome unknown"),false);
 assert.equal(check([denied],"ui_click","No Windows action was sent"),false);
 assert.equal(check([denied],"ui_click",ERR,"other-action"),false);
 assert.equal(check([denied],"launch_app"),false);
});
test("unknown or contradictory native execution log always dominates denied receipt",()=>{
 for(const event of ["executed","executing","started","failed","error"]){
  assert.equal(check([denied,{action_id:A,tool:"ui_click",event,success:false}]),false,event);
 }
 assert.equal(check([denied,{...denied,tool:"ui_toggle",event:"executed",success:true}]),false);
 assert.equal(check([{...denied,success:true}]),false);
 assert.equal(check([denied,{...denied}]),false);
});
test("mismatched tool, unbounded or malformed audit cannot legitimize expiry",()=>{
 assert.equal(check([{...denied,tool:"ui_toggle"}]),false);
 assert.equal(check([{...denied,action_id:"foreign"}]),false);
 assert.equal(check(null),false);
 assert.equal(check([null]),false);
 assert.equal(check(Array.from({length:201},()=>denied)),false);
 assert.equal(check([denied],"ui_click",ERR,"x".repeat(129)),false);
});
test("only the seven consented mutating UIA action kinds qualify",()=>{
 for(const tool of ["ui_click","ui_set_value","ui_focus","ui_scroll","ui_toggle","ui_expand_collapse","ui_send_keys"]){
  assert.equal(check([{...denied,tool}],tool),true,tool);
 }
 for(const tool of ["ui_windows","ui_find","ui_discover","inspect_screen","pointer_click","launch_app"]){
  assert.equal(check([{...denied,tool}],tool),false,tool);
 }
});
test("Dashboard expiry classification is immediately audit-gated and cannot automatically replay",()=>{
 const src=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const catchStart=src.indexOf("if(message.includes(\"Prepared action expired before execution\"))");
 const helper=src.indexOf("auditedNativeUiaExpiry(",catchStart);
 const stop=src.indexOf('haltTask(current.threadId,journalOk?"approval_expired"',helper);
 const replay=src.indexOf('await prepareAuditedUiReadRecovery(current,message)',helper);
 assert.ok(catchStart>=0&&helper>catchStart&&stop>helper&&replay>stop);
 assert.match(src.slice(catchStart,replay),/"action_audit_trace",\{actionId:current\.action\.id\}/);
 assert.match(src.slice(stop,replay),/return;/);
 assert.match(src,/persistRecovery\(expiryBudget,"native_denied",current.action.id\)/);
});
