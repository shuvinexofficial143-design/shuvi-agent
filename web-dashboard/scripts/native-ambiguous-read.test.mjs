import test from "node:test";import assert from "node:assert/strict";
import {checkAmbiguousReadWindow as check} from "../src/native-window-target-guard.mjs";
const observed=[{title:"Premiere",pid:1,hwnd:2},{title:"Premiere",pid:3,hwnd:4}];
test("ambiguous previously observed window rejects read-only lookup by indistinguishable title",()=>{
 assert.equal(check({tool:"ui_discover",arguments:{window:"Premiere"}},observed).allowed,false);
 assert.equal(check({tool:"ui_find",arguments:{window:"Premiere"}},observed).allowed,false);
 assert.equal(check({tool:"ui_windows",arguments:{}},observed).allowed,true);
 assert.equal(check({tool:"ui_find",arguments:{window:"Photoshop"}},observed).allowed,true);
 assert.equal(check({tool:"ui_find",arguments:{window:"Premiere"}},null).allowed,true);
});
