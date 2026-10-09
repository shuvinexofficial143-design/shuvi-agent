import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRemoteApi} from "../server/remote-api-core.mjs";
import {REMOTE_PROTOCOL} from "../src/remote-command-contract.mjs";

const A="a".repeat(32),B="b".repeat(32),C="c".repeat(32),D="d".repeat(32),E="e".repeat(32),F="f".repeat(32);
const USERKEY="1".repeat(64),AGENTKEY="2".repeat(64),now=1791540000000;
const digest=s=>createHash("sha256").update(s).digest("hex");
const env={SHUVI_REMOTE_OWNER_ID:A,SHUVI_REMOTE_DEVICE_ID:B,
 SHUVI_REMOTE_OWNER_KEY_SHA256:digest(USERKEY),
 SHUVI_REMOTE_AGENT_KEY_SHA256:digest(AGENTKEY)};
const state=new Map();
const store={async transact(key,fn) {
 const current=state.has(key)?structuredClone(state.get(key)):null;
 const {next,result}=fn(current);
 state.set(key,structuredClone(next));return result;
}};
const api=createRemoteApi({store,env,clock:()=>now});
const message=()=>({protocol:REMOTE_PROTOCOL,type:"user_message",ownerId:A,deviceId:B,
 threadId:C,messageId:D,taskId:E,sequence:1,issuedAt:now-1000,expiresAt:now+90000,
 mode:"task",text:"Shuvi, open Notepad"});
function request(kind,method="GET",body,key){
 const req={method,headers:{authorization:"Bearer "+(key??(kind==="user"?USERKEY:AGENTKEY)),
  "content-type":"application/json"},body};
 const output={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.json=JSON.parse(s);}};
 return api(kind,req,output).then(()=>output);
}
test("reject wrong roles, missing tokens, malformed config",async()=>{
 assert.throws(()=>createRemoteApi({store,env:{}}),/remote_auth_unconfigured/);
 assert.equal((await request("agent","GET",undefined,USERKEY)).statusCode,401);
 assert.equal((await request("user","GET",undefined,AGENTKEY)).statusCode,401);
 assert.equal((await request("user","GET",undefined,"123")).statusCode,401);
});
test("server-minted principal, queued remote command, bounded outbound poll",async()=>{
 const desc=await request("user"); assert.equal(desc.json.value.lastSequence,0);
 const sent=await request("user","POST",{operation:"submit",message:message()});
 assert.equal(sent.statusCode,202);
 const polled=await request("agent");
 assert.equal(polled.statusCode,200);
 assert.equal(polled.json.value.messages[0].text,"Shuvi, open Notepad");
 assert.equal(polled.json.value.messages[0].taskId,E);
 assert.equal((await request("user")).json.value.lastSequence,1);
 assert.equal((await request("user","POST",{operation:"submit",message:message()})).statusCode,409);
});
test("agent receipt only and no browser receipt spoof",async()=>{
 assert.equal((await request("user","POST",{operation:"receipt",receipt:{}})).statusCode,400);
 const r={protocol:REMOTE_PROTOCOL,type:"task_receipt",ownerId:A,deviceId:B,threadId:C,messageId:D,
 taskId:E,revision:2,occurredAt:now,status:"admitted"};
 assert.equal((await request("agent","POST",{operation:"receipt",receipt:r})).statusCode,200);
 assert.equal((await request("agent")).json.value.messages.length,0);
});
test("invalid input must fail closed without emitting secrets",async()=>{
 const x=await request("user","POST",{operation:"unknown"});
 assert.equal(x.statusCode,400);
 assert.doesNotMatch(JSON.stringify(x.json),/1111111111111111|2222222222222222/);
});
