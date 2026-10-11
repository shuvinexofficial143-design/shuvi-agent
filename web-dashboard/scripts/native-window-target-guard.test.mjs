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
