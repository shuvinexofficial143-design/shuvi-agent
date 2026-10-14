import test from "node:test";
import assert from "node:assert/strict";
import { REMOTE_PROTOCOL, MAX_COMMAND_TTL_MS, validateRemoteMessage,
  validateTaskReceipt, validateReceiptTransition, validateApprovalBinding
} from "../src/remote-command-contract.mjs";

const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32);
const D = "d".repeat(32), E = "e".repeat(32), F = "f".repeat(32);
const now = 1791540000000;
const message = () => ({
  protocol:REMOTE_PROTOCOL,type:"user_message",ownerId:A,deviceId:B,threadId:C,
  messageId:D,taskId:E,sequence:4,issuedAt:now-2000,
  expiresAt:now+60000,mode:"task",text:"Open Premiere Pro"
});
const ctx = () => ({
  ownerId:A,deviceId:B,now,lastSequence:3,
  seenMessageIds:new Set(),seenTaskIds:new Set()
});
const receipt = (status, revision, extras={}) => ({
  protocol:REMOTE_PROTOCOL,type:"task_receipt",ownerId:A,deviceId:B,
  threadId:C,messageId:D,taskId:E,revision,occurredAt:now+revision*100,
  status,...extras
});

test("well-formed messages are only validated, never executed",()=>{
 const r=validateRemoteMessage(message(),ctx());
 assert.equal(r.ok,true);
 assert.equal(r.value.text,"Open Premiere Pro");
 assert.equal(Object.isFrozen(r.value),true);
});
test("owner/device spoof and missing authoritative replay ledger fail closed",()=>{
 assert.equal(validateRemoteMessage({...message(),ownerId:F},ctx()).error,"wrong_owner_or_device");
 assert.equal(validateRemoteMessage({...message(),deviceId:F},ctx()).error,"wrong_owner_or_device");
 assert.equal(validateRemoteMessage(message(),{...ctx(),seenTaskIds:undefined}).error,"missing_authoritative_replay_state");
});
test("duplicate message, task and out-of-order sequence are rejected",()=>{
 assert.equal(validateRemoteMessage(message(),{...ctx(),seenMessageIds:new Set([D])}).error,"duplicate_message_or_task");
 assert.equal(validateRemoteMessage(message(),{...ctx(),seenTaskIds:new Set([E])}).error,"duplicate_message_or_task");
 assert.equal(validateRemoteMessage(message(),{...ctx(),lastSequence:4}).error,"stale_sequence");
});
test("expired, future and overlong commands fail",()=>{
 assert.equal(validateRemoteMessage({...message(),expiresAt:now},ctx()).error,"expired_or_invalid_ttl");
 assert.equal(validateRemoteMessage({...message(),issuedAt:now+31000},ctx()).error,"expired_or_invalid_ttl");
 assert.equal(validateRemoteMessage({...message(),expiresAt:now-2000+MAX_COMMAND_TTL_MS+1},ctx()).error,"expired_or_invalid_ttl");
 assert.equal(validateRemoteMessage({...message(),text:"x".repeat(2501)},ctx()).error,"invalid_text");
 assert.equal(validateRemoteMessage({...message(),text:"execute\u0000"},ctx()).error,"invalid_text");
});
test("only known chat/task modes and complete envelope accepted",()=>{
 assert.equal(validateRemoteMessage({...message(),mode:"powershell"},ctx()).error,"invalid_mode");
 assert.equal(validateRemoteMessage({...message(),taskId:"x"},ctx()).error,"invalid_envelope");
});
test("only received revision one starts receipt stream",()=>{
 assert.equal(validateReceiptTransition(null,receipt("received",1)).ok,true);
 assert.equal(validateReceiptTransition(null,receipt("running",1)).ok,false);
 assert.equal(validateReceiptTransition(null,receipt("received",2)).ok,false);
});
test("task receipt follows explicit graph and monotonic revision",()=>{
 const a=receipt("received",1), b=receipt("admitted",2), c=receipt("running",3);
 assert.equal(validateReceiptTransition(a,b).ok,true);
 assert.equal(validateReceiptTransition(b,c).ok,true);
 assert.equal(validateReceiptTransition(c,receipt("outcome_unknown",4)).ok,true);
 assert.equal(validateReceiptTransition(c,receipt("running",4)).error,"forbidden_state_transition");
 assert.equal(validateReceiptTransition(c,receipt("failed",5)).error,"stale_or_out_of_order_receipt");
 assert.equal(validateReceiptTransition(c,{...receipt("failed",4),taskId:F}).error,"receipt_identity_mismatch");
});
test("success cannot be declared without native audit evidence",()=>{
 const run=receipt("running",3);
 assert.equal(validateTaskReceipt(receipt("succeeded",4)).error,"success_requires_native_evidence");
 const done=receipt("succeeded",4,{evidence:{kind:"native_audit",id:F}});
 assert.equal(validateReceiptTransition(run,done).ok,true);
 assert.equal(validateReceiptTransition(done,receipt("running",5)).error,"forbidden_state_transition");
});
test("approval is bound to exactly one live task and one-use identifier",()=>{
 const pending=receipt("requires_approval",3,{approvalId:F,approvalExpiresAt:now+30000});
 const request={approvalId:F,taskId:E,ownerId:A,deviceId:B,decision:"approve"};
 const context={ownerId:A,deviceId:B,now,consumedApprovalIds:new Set()};
 assert.equal(validateApprovalBinding(request,pending,context).ok,true);
 assert.equal(validateApprovalBinding({...request,taskId:C},pending,context).error,"approval_binding_mismatch");
 assert.equal(validateApprovalBinding(request,pending,{...context,now:now+30000}).error,"approval_expired");
 assert.equal(validateApprovalBinding(request,pending,{...context,consumedApprovalIds:new Set([F])}).error,"approval_replay");
 assert.equal(validateApprovalBinding(request,receipt("running",3),context).error,"no_pending_approval");
 assert.equal(validateTaskReceipt(receipt("requires_approval",3)).error,"approval_requires_binding_and_expiry");
});
