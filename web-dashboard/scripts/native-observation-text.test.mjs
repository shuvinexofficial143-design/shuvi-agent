import test from "node:test";import assert from "node:assert/strict";
import {cleanObservedLabel} from "../src/native-observation-text.mjs";
test("invisible control and bidi characters cannot masquerade as legitimate UI labels",()=>{
 assert.equal(cleanObservedLabel("New\u202e Project\n\tButton\u200b"),"New Project Button");
 assert.equal(cleanObservedLabel("Name\u0000\u0001"),"Name");
 assert.equal(cleanObservedLabel(null),"");
});
test("tool-output label normalization is bounded and leaves normal UI names legible",()=>{
 assert.equal(cleanObservedLabel("Adobe Premiere Pro 2026"),"Adobe Premiere Pro 2026");
 assert.equal(cleanObservedLabel("x".repeat(1000)).length,180);
 assert.equal(cleanObservedLabel("Save Project",12),"Save Project");
});
