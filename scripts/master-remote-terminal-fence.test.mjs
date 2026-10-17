import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {terminalRemoteReceiptClearAllowed as canClear} from "../src/master-remote-terminal-fence.mjs";
test("positive exact terminal acknowledgement retires only its own mobile task",()=>{
 const task={message:{taskId:"A"},revision:7};
 assert.equal(canClear(task,task,true),true);
 assert.equal(canClear(task,task,false),false);
 assert.equal(canClear(task,{...task},true),false);
 assert.equal(canClear(task,null,true),false);
 assert.equal(canClear(null,task,true),false);
});
test("asynchronous unconfirmed server receipt cannot retire another task or enable new inbox admission",async()=>{
 const task={message:{taskId:"A"}},newer={message:{taskId:"B"}};
 let active=task,accepted=false,resolve;
 const reply=new Promise(r=>resolve=r);
 const completion=(async()=>{accepted=await reply;return canClear(task,active,accepted)})();
 active=newer;resolve(true);
 assert.equal(await completion,false);
 assert.equal(canClear(task,task,false),false);
});
test("Desktop does not clear a terminal remote task when Rust server acknowledgement is missing",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const a=ui.indexOf("async function closeRemoteTask("),b=ui.indexOf("async function tickRemoteAgent(",a);
 const source=ui.slice(a,b);
 const accepted=source.indexOf("acknowledged=await sendRemoteReceipt(status,extras)");
 const check=source.indexOf("terminalRemoteReceiptClearAllowed(closingTask,remoteTask,acknowledged)",accepted);
 const fail=source.indexOf("revokeTaskScope(closingScope)",check);
 const clear=source.indexOf("remoteTask=null;",fail);
 assert.ok(accepted>=0&&check>accepted&&fail>check&&clear>fail);
 assert.match(source,/if\(remoteTask!==closingTask\)return false;/);
 assert.match(source,/if\(activePermissionScope!==closingScope\)return false;/);
 assert.match(source,/cancelRequested=true;/);
 assert.match(source,/previous task held for owner review/);
});
test("unconfirmed terminal response never invents a successful native action receipt",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const t=ui.slice(ui.indexOf("async function closeRemoteTask("),ui.indexOf("async function tickRemoteAgent("));
 assert.doesNotMatch(t,/remoteTask\.evidenceActionId\s*=/);
 assert.doesNotMatch(t,/execute_action|grantTaskRead/);
});
