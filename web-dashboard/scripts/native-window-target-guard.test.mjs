import test from "node:test";import assert from "node:assert/strict";
import {observedWindowInventory,checkObservedMutationTarget as check} from "../src/native-window-target-guard.mjs";
const list=[{Name:"Adobe Premiere Pro 2026",ProcessId:123,NativeWindowHandle:1},
 {Name:"Adobe Photoshop 2026",ProcessId:456,NativeWindowHandle:2}];
const observed=observedWindowInventory({tool:"ui_windows",success:true,stdout:JSON.stringify(list)},true);
test("only audited successful window read yields constrained inventory",()=>{
 assert.equal(observedWindowInventory({tool:"ui_windows",success:true,stdout:"[]"},false),null);
 assert.equal(observedWindowInventory({tool:"ui_click",success:true,stdout:"[]"},true),null);
 assert.equal(observed.length,2);
});
test("wrong app and unknown window blocked before staging, reads still allowed",()=>{
 assert.equal(check({tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026"}},observed).allowed,true);
 assert.equal(check({tool:"ui_click",arguments:{window:"Adobe Illustrator 2026"}},observed).allowed,false);
 assert.equal(check({tool:"ui_send_keys",arguments:{}},observed).allowed,false);
 assert.equal(check({tool:"ui_windows",arguments:{}},[]).allowed,true);
 assert.equal(check({tool:"ui_click",arguments:{}},null).allowed,true,"native Rust validation remains");
});
test("duplicate exact window titles are ambiguous even if names match",()=>{
 const duplicate=[...observed,{title:"Adobe Premiere Pro 2026",pid:789,hwnd:3}];
 assert.match(check({tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026"}},duplicate).reason,/Ambiguous/);
});

test("Batch 26 multiple observed rows with one handle remain ambiguous",()=>{
 const duplicate=[{title:"Premiere",pid:1,hwnd:3},{title:"Premiere",pid:1,hwnd:3}];
 assert.equal(check({tool:"ui_click",arguments:{window:"Premiere"}},duplicate).allowed,false);
});

test("Batch 38 normalized native window labels cannot hide bidi text or null characters",()=>{
 const result={tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Adobe\u202e Premiere\u0000 Pro",ProcessId:123,NativeWindowHandle:5}
 ])};
 const titles=observedWindowInventory(result,true);
 assert.equal(titles.length,1);
 assert.equal(titles[0].title,"Adobe Premiere Pro");
 assert.doesNotMatch(titles[0].title,/[\u202a-\u202e]/);
});

test("Batch 40 huge or non-string UI inventory never authorizes a mutation",()=>{
 const huge={tool:"ui_windows",success:true,stdout:"["+" ".repeat(250001)+"]"};
 assert.deepEqual(observedWindowInventory(huge,true),[]);
 assert.deepEqual(observedWindowInventory({...huge,stdout:null},true),[]);
 assert.equal(check({tool:"ui_click",arguments:{window:"Premiere"}},observedWindowInventory(huge,true)).allowed,false);
});

test("Batch 44 conflicting title/process on same handle fails closed",()=>{
 const impossible=[{title:"Adobe Premiere Pro",pid:100,hwnd:7},
  {title:"Adobe Photoshop",pid:200,hwnd:7}];
 assert.equal(check({tool:"ui_click",arguments:{window:"Adobe Premiere Pro"}},impossible).allowed,false);
 assert.equal(check({tool:"ui_click",arguments:{window:"Adobe Photoshop"}},impossible).allowed,false);
});

test("Batch 49 invisible directional characters in proposed window target are not normalized into authorization",()=>{
 const observed=[{title:"Adobe Premiere Pro 2026",pid:12,hwnd:13}];
 assert.equal(check({tool:"ui_click",arguments:{window:"Adobe Premiere\u202e Pro 2026"}},observed).allowed,false);
});

test("Batch 84 invalid UI inventory exit status never authorizes a target mutation",()=>{
 const good={tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Premiere",ProcessId:123,NativeWindowHandle:456}])};
 for(const exit_code of [1,-1,"0",false,NaN]){
  const inventory=observedWindowInventory({...good,exit_code},true);
  assert.deepEqual(inventory,[]);
  assert.equal(check({tool:"ui_click",arguments:{window:"Premiere"}},inventory).allowed,false);
 }
 assert.equal(observedWindowInventory({...good,exit_code:0},true).length,1);
});

test("Batch 85 one malformed duplicate row invalidates the entire audited target snapshot",()=>{
 const result={tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Premiere",ProcessId:1,NativeWindowHandle:5},
  {Name:"Premiere",ProcessId:"missing",NativeWindowHandle:6}
 ])};
 const inventory=observedWindowInventory(result,true);
 assert.deepEqual(inventory,[]);
 assert.equal(check({tool:"ui_click",arguments:{window:"Premiere"}},inventory).allowed,false);
});

test("Batch 95 native window target refuses cross-app process/title disagreement",()=>{
 const mismatch=observedWindowInventory({tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Adobe Premiere Pro",ProcessName:"Adobe Photoshop",ProcessId:44,NativeWindowHandle:5}
 ])},true);
 assert.equal(mismatch[0].process,"Adobe Photoshop");
 assert.equal(check({tool:"ui_click",arguments:{window:"Adobe Premiere Pro"}},mismatch).allowed,false);
 const valid=observedWindowInventory({tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Adobe Premiere Pro",ProcessName:"Adobe Premiere Pro.exe",ProcessId:45,NativeWindowHandle:6}
 ])},true);
 assert.equal(check({tool:"ui_click",arguments:{window:"Adobe Premiere Pro"}},valid).allowed,true);
});
