import test from "node:test";
import assert from "node:assert/strict";
import {actionFingerprint,seenAfterAuditedChange,actionLoopGuidance} from "../src/native-action-loop.mjs";

test("canonical action identity ignores JSON property order, not distinct selector values",()=>{
 const a=actionFingerprint({tool:"ui_find",arguments:{window:"Adobe Premiere",name:"New Project",options:{b:2,a:1}}});
 const b=actionFingerprint({arguments:{options:{a:1,b:2},name:"New Project",window:"Adobe Premiere"},tool:"ui_find"});
 assert.equal(a,b);
 assert.notEqual(a,actionFingerprint({tool:"ui_find",arguments:{window:"Adobe Premiere",name:"Open Project",options:{a:1,b:2}}}));
 assert.notEqual(actionFingerprint({tool:"ui_find",arguments:{name:"New Project"}}),
  actionFingerprint({tool:"ui_discover",arguments:{name:"New Project"}}));
});
test("duplicate guard rejects unsafe unbounded or malformed proposals",()=>{
 assert.equal(actionFingerprint({tool:"ui_click",arguments:{value:()=>42}}),null);
 assert.equal(actionFingerprint({tool:"ui_click",arguments:{long:"x".repeat(20000)}}),null);
 assert.equal(actionFingerprint({tool:"some tool",arguments:{}}),null);
 const circular={};circular.self=circular;
 assert.equal(actionFingerprint({tool:"ui_find",arguments:circular}),null);
});
test("only audited UI mutations unlock repeat observations, never mutation repeats",()=>{
 const r=actionFingerprint({tool:"ui_windows",arguments:{}});
 const d=actionFingerprint({tool:"ui_discover",arguments:{window:"Premiere"}});
 const m=actionFingerprint({tool:"ui_click",arguments:{window:"Premiere",name:"New Project"}});
 const seen=new Set([r,d,m]);
 assert.strictEqual(seenAfterAuditedChange(seen,"ui_click",false),seen);
 assert.strictEqual(seenAfterAuditedChange(seen,"ui_windows",true),seen);
 assert.strictEqual(seenAfterAuditedChange(seen,"unknown_tool",true),seen);
 const after=seenAfterAuditedChange(seen,"ui_click",true);
 assert.equal(after.has(r),false);
 assert.equal(after.has(d),false);
 assert.equal(after.has(m),true,"previously-approved mutation still remembered");
 assert.equal(seen.has(r),true,"do not mutate prior task snapshot");
 const guidance=actionLoopGuidance();
 assert.match(guidance,/reordered JSON arguments/);
 assert.match(guidance,/verified intervening UI change/);
 assert.match(guidance,/No extra paid retries/);
});
