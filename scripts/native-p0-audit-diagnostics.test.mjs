import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {diagnoseNativeAction} from "../web-dashboard/src/native-action-receipts.mjs";

const id="123e4567-e89b-42d3-a456-426614174000";
const prepared={id,kind:"ui_discover"};
const result={tool:"ui_discover",success:true,exit_code:0};
const done={action_id:id,tool:"ui_discover",event:"executed",success:true};
const fail={...done,event:"failed",success:false};
const verdict=(r=result,a=[done],worker=null)=>diagnoseNativeAction(prepared,r,a,worker);

test("P0-A exact UUID and typed worker readback required; safe reads are not automatically replayed",()=>{
 assert.equal(verdict().kind,"verified");
 assert.equal(verdict().replayAllowed,false);
 assert.equal(verdict().safeRead,true);
 assert.equal(verdict(result,[]).kind,"missing_audit");
 assert.equal(verdict(result,null).kind,"missing_audit");
 assert.equal(verdict(result,[{...done,action_id:"foreign"}]).kind,"identity_mismatch");
 assert.equal(verdict(result,[{...done,tool:"ui_windows"}]).kind,"identity_mismatch");
 assert.equal(verdict({...result,tool:"ui_windows"}).kind,"identity_mismatch");
 assert.equal(verdict({...result,exit_code:1}).kind,"readback_failed");
 assert.equal(verdict({...result,success:false}).kind,"readback_failed");
 assert.equal(verdict(null).kind,"verified_audit_only");
});
test("P0-A preserves terminal failures and never green-lights unknown mutations",()=>{
 assert.equal(verdict(result,[fail]).kind,"worker_failure");
 assert.equal(verdict(result,[{...done,event:"denied",success:false}]).kind,"denied");
 assert.equal(verdict(result,[{...done,event:"outcome_unknown",success:false}]).kind,"worker_unresolved");
 assert.equal(verdict(result,[done,done]).kind,"audit_conflict");
 assert.equal(verdict(result,[done,fail]).kind,"audit_conflict");
 assert.equal(verdict(result,[done],{durableJobActionId:id,durableJobTool:"ui_windows",durableJobPhase:"audit_verified"}).kind,"identity_mismatch");
 assert.equal(verdict(result,[done],{durableJobActionId:id,durableJobTool:"ui_discover",durableJobPhase:"outcome_unknown"}).kind,"worker_unresolved");
 const mut=diagnoseNativeAction({id,kind:"premiere_apply_assembly"},
   {tool:"premiere_apply_assembly",success:true,exit_code:0},
   [{...done,tool:"premiere_apply_assembly",event:"outcome_unknown",success:false}]);
 assert.equal(mut.kind,"worker_unresolved");
 assert.equal(mut.safeRead,false);
 assert.equal(mut.replayAllowed,false);
});
test("P0-A executor uses exact rotated audit trace rather than global last-200 audit_log",()=>{
 const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 const ts=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const start=rust.indexOf("fn read_action_audit_trace(");
 const block=rust.slice(start,rust.indexOf("fn premiere_checkpoint_from_audit(",start));
 assert.ok(start>0);
 assert.match(block,/Uuid::parse_str\(action_id\)/);
 assert.match(block,/for candidate in \[&rotated,&path\]/);
 assert.match(block,/trace\.len\(\)>=64/);
 assert.match(rust,/fn action_audit_trace\(action_id:String,app:AppHandle\)/);
 const verifier=ts.slice(ts.indexOf("// P0-A: global audit tail"),ts.indexOf("executionVerified=verified;"));
 assert.match(verifier,/"action_audit_trace"/);
 assert.doesNotMatch(verifier,/"audit_log"/);
});
