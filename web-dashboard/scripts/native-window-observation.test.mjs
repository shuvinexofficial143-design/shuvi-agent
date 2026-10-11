import test from "node:test";import assert from "node:assert/strict";
import {summarizeWindowObservation as guide} from "../src/native-window-observation.mjs";
test("no audit or unrelated Windows tool cannot ground an app title",()=>{
 const result={tool:"ui_windows",success:true,stdout:JSON.stringify([{Name:"Premiere"}])};
 assert.equal(guide(result,false),"");
 assert.equal(guide({...result,tool:"ui_click"},true),"");
 assert.equal(guide({...result,success:false},true),"");
});
test("verified observation retains exact title and process but does not choose a window",()=>{
 const x=guide({tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:320,NativeWindowHandle:891},
  {Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:420,NativeWindowHandle:892}
 ])},true);
 assert.match(x,/2 usable window identity/);
 assert.match(x,/Adobe Premiere Pro 2026/);
 assert.match(x,/892/);
 assert.match(x,/NOT a selected target/);
 assert.match(x,/never pick the first matching window/);
});
test("malformed data, no rows and oversized inventory remain bounded",()=>{
 assert.match(guide({tool:"ui_windows",success:true,stdout:"not-json"},true),/unparseable/);
 assert.match(guide({tool:"ui_windows",success:true,stdout:"[]"},true),/no window identities/);
 const many=Array.from({length:300},(_,i)=>({Name:"Title "+i+" ".repeat(300),ProcessName:"Proc",ProcessId:i,NativeWindowHandle:i+1}));
 const output=guide({tool:"ui_windows",success:true,stdout:JSON.stringify(many)},true);
 assert.ok(output.length<2400);
 assert.match(output,/input bounded/);
});

test("Batch 25 visible window summaries strip invisible directional marks",()=>{
 const result={tool:"ui_windows",success:true,stdout:JSON.stringify([{Name:"Premiere\u202e Project",ProcessName:"Adobe Premiere",ProcessId:123,NativeWindowHandle:101}])};
 const output=guide(result,true);
 assert.doesNotMatch(output,/[\u202a-\u202e]/u);
 assert.match(output,/Premiere/);
});

test("Batch 39 oversized native window observation never enters model window summary",()=>{
 const giant={tool:"ui_windows",success:true,stdout:"["+" ".repeat(250001)+"]"};
 assert.match(guide(giant,true),/too large or unavailable/);
 assert.equal(guide(giant,false),"");
});

test("Batch 80 duplicate OS window rows remain visible as ambiguous observations",()=>{
 const same={Name:"Adobe Premiere Pro",ProcessName:"Premiere",ProcessId:123,NativeWindowHandle:44};
 const text=guide({tool:"ui_windows",success:true,stdout:JSON.stringify([same,same])},true);
 assert.match(text,/2 usable window identity/);
 assert.match(text,/NOT a selected target/);
});

test("Batch 86 unsuccessful or malformed typed window read is never described as verified",()=>{
 const base={tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Premiere",ProcessName:"Premiere",ProcessId:1,NativeWindowHandle:2}])};
 for(const exit_code of [1,-1,"0",false,NaN])
  assert.match(guide({...base,exit_code},true),/no target identity verified/);
 assert.match(guide({...base,exit_code:0},true),/Verified read-only/);
});
