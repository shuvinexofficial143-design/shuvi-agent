import test from "node:test";import assert from "node:assert/strict";
import {checkAmbiguousReadWindow as check} from "../src/native-window-target-guard.mjs";
const observed=[{title:"Premiere",pid:1,hwnd:2},{title:"Premiere",pid:3,hwnd:4}];
test("ambiguous previously observed window rejects read-only lookup by indistinguishable title",()=>{
 assert.equal(check({tool:"ui_discover",arguments:{window:"Premiere"}},observed).allowed,false);
 assert.equal(check({tool:"ui_find",arguments:{window:"Premiere"}},observed).allowed,false);
 assert.equal(check({tool:"ui_windows",arguments:{}},observed).allowed,true);
 assert.equal(check({tool:"ui_find",arguments:{window:"Photoshop"}},observed).allowed,false);
 assert.equal(check({tool:"ui_find",arguments:{window:"Premiere"}},null).allowed,true);
});

test("Batch 37 repeat inventory rows for one window title still block UI lookup",()=>{
 const two=[{title:"Premiere",pid:1,hwnd:2},{title:"Premiere",pid:1,hwnd:2}];
 assert.equal(check({tool:"ui_find",arguments:{window:"Premiere"}},two).allowed,false);
});

test("Batch 48 UI read-only lookup refuses contradictory process on same window handle",()=>{
 const impossible=[{title:"Premiere",pid:100,hwnd:7},{title:"Photoshop",pid:101,hwnd:7}];
 assert.equal(check({tool:"ui_find",arguments:{window:"Premiere"}},impossible).allowed,false);
 assert.equal(check({tool:"ui_discover",arguments:{window:"Photoshop"}},impossible).allowed,false);
});

test("Batch 96 read-only selectors cannot use stale or unknown audited window targets",()=>{
 assert.equal(check({tool:"ui_find",arguments:{window:"Premiere"}},[]).allowed,false);
 assert.equal(check({tool:"ui_discover",arguments:{window:"Not observed"}},[{title:"Premiere",pid:1,hwnd:2}]).allowed,false);
 assert.equal(check({tool:"ui_find",arguments:{window:"Premiere"}},[{title:"Premiere",pid:1,hwnd:2}]).allowed,true);
 assert.equal(check({tool:"ui_find",arguments:{window:"Other"}},null).allowed,true,"Rust owns validation without an inventory");
});
