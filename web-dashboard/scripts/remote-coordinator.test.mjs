import test from "node:test";
import assert from "node:assert/strict";
import {createRemoteCoordinator} from "../server/remote-coordinator.mjs";
import {REMOTE_PROTOCOL} from "../src/remote-command-contract.mjs";

const A="a".repeat(32),B="b".repeat(32),C="c".repeat(32),
      D="d".repeat(32),E="e".repeat(32),F="f".repeat(32);
let now=1791540000000;
const trusted=new WeakSet();
function issue(kind,ownerId=A,deviceId=B) {
 const actor={kind,ownerId,deviceId};
 trusted.add(actor);
 return actor;
}
const user=issue("user");
const agent=issue("agent");
const command=()=>({
  protocol:REMOTE_PROTOCOL,type:"user_message",ownerId:A,deviceId:B,
  threadId:C,messageId:D,taskId:E,sequence:1,issuedAt:now-1000,
  expiresAt:now+120000,mode:"task",text:"Open Notepad"
});
const receipt=(status,revision,extras={})=>({
 protocol:REMOTE_PROTOCOL,type:"task_receipt",ownerId:A,deviceId:B,
 threadId:C,messageId:D,taskId:E,revision,occurredAt:now,status,...extras
});
const memoryStore=()=>{
 const saved=new Map();
 return {transact:async (key,fn)=>{
   const current=saved.has(key)?structuredClone(saved.get(key)):null;
   const {next,result}=fn(current);
   saved.set(key,structuredClone(next));
   return result;
 }};
};
const setup=()=>createRemoteCoordinator({
 store:memoryStore(),clock:()=>now,verifyActor:actor=>trusted.has(actor)
});

test("requires a transactional store; is NOT automatically networked",()=>{
 assert.throws(()=>createRemoteCoordinator(),/Durable atomic store required/);
 assert.throws(()=>createRemoteCoordinator({store:memoryStore()}),/Server-side actor verifier required/);
 const c=setup();
 assert.equal(typeof c.admit,"function");
 assert.equal("fetch" in c,false);
});

test("trusted contexts gate every operation",async()=>{
 const c=setup();
 assert.equal((await c.admit({...user,authenticated:true},command())).error,"unauthenticated_actor");
 assert.equal((await c.poll(user)).error,"unauthenticated_actor");
 assert.equal((await c.list(agent)).error,"unauthenticated_actor");
 assert.equal((await c.recordReceipt(user,receipt("admitted",2))).error,"unauthenticated_actor");
});

test("single admission, replay rejection and scoped polling",async()=>{
 const c=setup();
 assert.equal((await c.admit(user,command())).ok,true);
 assert.equal((await c.admit(user,command())).error,"duplicate_message_or_task");
 const got=await c.poll(agent);
 assert.equal(got.ok,true);
 assert.equal(got.value.messages.length,1);
 assert.equal(got.value.messages[0].text,"Open Notepad");
 assert.equal((await c.poll(issue("agent",A,F))).value.messages.length,0);
 assert.equal((await c.list(issue("user",F,B))).value.length,0);
});

test("received → admitted → running → success native evidence; no resurrection",async()=>{
 const c=setup();
 await c.admit(user,command());
 assert.equal((await c.recordReceipt(agent,receipt("admitted",2))).ok,true);
 assert.equal((await c.poll(agent)).value.messages.length,0);
 assert.equal((await c.recordReceipt(agent,receipt("running",3))).ok,true);
 assert.equal((await c.recordReceipt(agent,receipt("succeeded",4))).error,"success_requires_native_evidence");
 assert.equal((await c.recordReceipt(agent,receipt("succeeded",4,{evidence:{kind:"native_audit",id:F}}))).ok,true);
 assert.equal((await c.recordReceipt(agent,receipt("running",5))).error,"forbidden_state_transition");
 assert.equal((await c.list(user)).value[0].status,"succeeded");
});

test("only device-scoped authenticated agent can report an outcome",async()=>{
 const c=setup();
 await c.admit(user,command());
 assert.equal((await c.recordReceipt(issue("agent",A,F),receipt("admitted",2))).error,"wrong_owner_or_device");
 assert.equal((await c.recordReceipt(agent,{...receipt("admitted",2),taskId:F})).error,"unknown_task");
 assert.equal((await c.recordReceipt(agent,{...receipt("admitted",2),occurredAt:now+50000})).error,"future_receipt");
});

test("approval intent is once-only, expires, and stays tied to one task",async()=>{
 const c=setup();
 await c.admit(user,command());
 await c.recordReceipt(agent,receipt("admitted",2));
 const pending=receipt("requires_approval",3,{approvalId:F,approvalExpiresAt:now+30000});
 assert.equal((await c.recordReceipt(agent,pending)).ok,true);
 const d={approvalId:F,taskId:E,ownerId:A,deviceId:B,decision:"approve"};
 assert.equal((await c.decide(user,{...d,taskId:C})).error,"unknown_task");
 assert.equal((await c.decide(user,d)).ok,true);
 assert.equal((await c.decide(user,d)).error,"approval_replay");
 assert.equal((await c.poll(agent)).value.decisions[0].approvalId,F);
 assert.equal((await c.recordReceipt(agent,receipt("running",4))).ok,true);
 assert.equal((await c.poll(agent)).value.decisions.length,0);
});

test("cancel requested is NOT task-stopped evidence",async()=>{
 const c=setup();
 await c.admit(user,command());
 assert.equal((await c.requestCancel(user,E)).ok,true);
 const poll=await c.poll(agent);
 assert.equal(poll.value.messages.length,0);
 assert.deepEqual(poll.value.pending,[{taskId:E,request:"cancel"}]);
 assert.equal((await c.list(user)).value[0].status,"received");
 assert.equal((await c.recordReceipt(agent,receipt("stopped",2))).ok,true);
 assert.equal((await c.requestCancel(user,E)).error,"terminal_task");
});

test("expired command remains recorded but is NEVER polled to execute",async()=>{
 const c=setup();
 await c.admit(user,command());
 now+=121000;
 assert.equal((await c.poll(agent)).value.messages.length,0);
 assert.equal((await c.list(user)).value[0].delivery,"expired_not_delivered");
 now-=121000;
});

test("invalid approval expiry and denial remain non-executing intent",async()=>{
 const c=setup();await c.admit(user,command());
 await c.recordReceipt(agent,receipt("admitted",2));
 await c.recordReceipt(agent,receipt("requires_approval",3,{approvalId:F,approvalExpiresAt:now+5000}));
 const d={approvalId:F,taskId:E,ownerId:A,deviceId:B,decision:"deny"};
 assert.equal((await c.decide(user,d)).value.decision,"deny");
 assert.equal((await c.poll(agent)).value.decisions[0].decision,"deny");
});

test("native resume receipt is blocked until this task has explicit live approval",async()=>{
 const c=setup();
 await c.admit(user,command());
 await c.recordReceipt(agent,receipt("admitted",2));
 await c.recordReceipt(agent,receipt("requires_approval",3,{approvalId:F,approvalExpiresAt:now+30000}));
 assert.equal((await c.recordReceipt(agent,receipt("running",4))).error,"missing_live_task_approval");
 const decision={approvalId:F,taskId:E,ownerId:A,deviceId:B,decision:"approve"};
 assert.equal((await c.decide(user,decision)).ok,true);
 assert.equal((await c.recordReceipt(agent,receipt("running",4))).ok,true);
});
test("expired approval is not delivered and cannot resume task",async()=>{
 const c=setup(); await c.admit(user,command());
 await c.recordReceipt(agent,receipt("admitted",2));
 await c.recordReceipt(agent,receipt("requires_approval",3,{approvalId:F,approvalExpiresAt:now+1000}));
 const decision={approvalId:F,taskId:E,ownerId:A,deviceId:B,decision:"approve"};
 assert.equal((await c.decide(user,decision)).ok,true);
 now+=1000;
 try {
  assert.equal((await c.poll(agent)).value.decisions.length,0);
  assert.equal((await c.recordReceipt(agent,receipt("running",4))).error,"missing_live_task_approval");
 } finally { now-=1000; }
});
