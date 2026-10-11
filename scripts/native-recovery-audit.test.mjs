import test from "node:test";
import assert from "node:assert/strict";
import {reconcileNativeActionAudit,recoveryAuditMessage} from "../web-dashboard/src/native-recovery-audit.mjs";
const id="action-123",ok={action_id:id,event:"executed",success:true,tool:"premiere_launch"};
test("exact independent Rust receipt and audit trail required for recovered execution",()=>{
 assert.deepEqual(reconcileNativeActionAudit(id,ok,[ok]),{kind:"executed_audited",tool:"premiere_launch"});
 for(const [receipt,trail] of [[null,[ok]],[ok,[]],[ok,[{...ok,action_id:"other"}]],
  [ok,[{...ok,tool:"ui_find"}]],[ok,[ok,{...ok,event:"failed",success:false}]],
  [ok,[{...ok,success:false}]]]){
  assert.equal(reconcileNativeActionAudit(id,receipt,trail).kind,"unknown");
 }
});
test("denied, failed, malformed audit entries remain separate from execution",()=>{
 for(const [event,kind] of [["denied","denied_audited"],["failed","failed_audited"]]){
  const record={...ok,event,success:false};
  assert.equal(reconcileNativeActionAudit(id,record,[record]).kind,kind);
 }
 for(const bad of [null,{},[],{...ok,event:"prepared"},{...ok,tool:"<img>"},{...ok,success:"true"}])
  assert.equal(reconcileNativeActionAudit(id,bad,[ok]).kind,"unknown");
 assert.match(recoveryAuditMessage({kind:"unknown",tool:null}),/UNKNOWN/);
 assert.match(recoveryAuditMessage({kind:"failed_audited",tool:"ui_find"}),/Side effects/);
});
