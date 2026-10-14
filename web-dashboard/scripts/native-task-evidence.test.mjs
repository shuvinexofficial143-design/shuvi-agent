import test from "node:test";import assert from "node:assert/strict";
import {newEvidence,recordAuditedEvidence,evidenceSummary} from "../src/native-task-evidence.mjs";
test("only exact successful Rust audit records a tool action, never goal success",()=>{
 const a=newEvidence(),v={tool:"ui_windows",success:true};
 assert.strictEqual(recordAuditedEvidence(a,"x",v,false),a);
 assert.strictEqual(recordAuditedEvidence(a,"x",{...v,success:false},true),a);
 const s=recordAuditedEvidence(a,"x",v,true);
 assert.equal(s.audited,1);assert.equal(s.observations[0].kind,"read_only");
 assert.strictEqual(recordAuditedEvidence(s,"x",v,true),s);
 assert.match(evidenceSummary(s),/Overall application\/task goals NOT independently verified/);
});
test("bounded history, unlimited audited step counter, malformed result blocked",()=>{
 let s=newEvidence();
 for(let i=0;i<30;i++)s=recordAuditedEvidence(s,"a"+i,{tool:"ui_click",success:true},true);
 assert.equal(s.audited,30);assert.equal(s.observations.length,12);
 assert.strictEqual(recordAuditedEvidence(s,"", {tool:"ui_click",success:true},true),s);
 assert.strictEqual(recordAuditedEvidence(s,"z",{tool:"invalid tool",success:true},true),s);
 assert.ok(evidenceSummary(s).length<400);
});

test("Batch 75 replaying an action beyond the last twelve audit rows is never double-counted",()=>{
 let state=newEvidence();
 for(let i=0;i<30;i++)state=recordAuditedEvidence(state,"unique-"+i,{tool:"ui_windows",success:true},true);
 assert.equal(state.observations.length,12);
 assert.strictEqual(recordAuditedEvidence(state,"unique-0",{tool:"ui_windows",success:true},true),state);
 assert.equal(state.audited,30);
});

test("Batch 76 audit evidence never counts a nonzero or malformed typed exit status",()=>{
 const state=newEvidence(),base={tool:"ui_click",success:true};
 for(const status of [1,-1,"0","1",true,false,0.5,NaN]){
  assert.strictEqual(recordAuditedEvidence(state,"step1",{...base,exit_code:status},true),state);
 }
 assert.equal(recordAuditedEvidence(state,"step1",{...base,exit_code:0},true).audited,1);
});
