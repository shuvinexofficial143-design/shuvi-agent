import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("read failure recovery reads exact action receipt and rejects contradictory audit trail",()=>{
 const begin=source.indexOf("async function prepareAuditedUiReadRecovery");
 const last=source.indexOf("async function decide",begin);
 const body=source.slice(begin,last);
 assert.match(body,/isAuditedUiReadFailure\(current\.action\.kind,message,current\.action\.id,receipt/);
 assert.match(body,/await invoke<Array<.*>>\("action_audit_trace",\{actionId:current\.action\.id\}\)/);
 assert.match(body,/contradictsFailureReceipt\(current\.action,auditTrail\)/);
 assert.ok(body.indexOf('contradictsFailureReceipt')<body.indexOf('const next=await invoke<Pending>("prepare_tool"'));
});
