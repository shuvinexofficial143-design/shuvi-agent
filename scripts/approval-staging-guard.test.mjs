import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stagingWasInvalidated} from "../src/approval-staging-guard.mjs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("slow native preparation fails closed on stop, new task, altered state and revoked grant",()=>{
 const scope={revoked:false},state={recovery_mode:"normal"};
 assert.equal(stagingWasInvalidated(scope,scope,state,state,false),false);
 assert.equal(stagingWasInvalidated(scope,scope,state,state,true),true);
 assert.equal(stagingWasInvalidated({...scope},scope,state,state,false),true);
 assert.equal(stagingWasInvalidated(scope,scope,state,{...state},false),true);
 scope.revoked=true;
 assert.equal(stagingWasInvalidated(scope,scope,state,state,false),true);
 assert.equal(stagingWasInvalidated(null,scope,state,state,false),true);
});
test("preparation is locally staged only after revalidating scope and must deny stale native UUIDs",()=>{
 const start=main.indexOf("async function stageProposal(");
 const end=main.indexOf("function clearChatPermission(",start);
 const src=main.slice(start,end);
 const prepare=src.indexOf('invoke<PendingAction>("prepare_tool"');
 const guard=src.indexOf("if (staleStage())",prepare);
 const assign=src.indexOf("pendingAction = staged;",prepare);
 assert.ok(prepare>=0 && guard>prepare && assign>guard);
 assert.match(src,/await denyStaleAction\(staged\?\.id\)/);
 assert.match(src,/if \(staleStage\(\)\) return;/);
 assert.match(src,/stagingState = orchestration;/);
 assert.match(src,/if \(staleStage\(\)\) \{[\s\S]*?await denyStaleAction\(preparedId\)/);
 assert.match(src,/if \(staleStage\(\)\) return;[\s\S]*?revokeTaskScope/);
});
test("PowerShell preparation never overlaps an active Chat request",()=>{
 const a=main.indexOf('el<HTMLButtonElement>("#prepareAction")');
 const b=main.indexOf("function renderManualPending",a);
 const src=main.slice(a,b);
 assert.match(src,/if \(manualActionRunning \|\| busy\)/);
});
