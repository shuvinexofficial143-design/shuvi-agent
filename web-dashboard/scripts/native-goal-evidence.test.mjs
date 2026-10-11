import test from "node:test";import assert from "node:assert/strict";
import {windowGoalEvidence,goalEvidenceLabel} from "../src/native-goal-evidence.mjs";
const windows=[{Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:321,NativeWindowHandle:501}];
const observation={tool:"ui_windows",success:true,stdout:JSON.stringify(windows)};
test("only an exact audited live app observation satisfies window criterion",()=>{
 assert.equal(windowGoalEvidence("Premiere kholo",observation,false),null);
 assert.equal(windowGoalEvidence("Premiere kholo",{...observation,tool:"premiere_launch"},true),null);
 assert.deepEqual(windowGoalEvidence("Premiere kholo",observation,true),
  {app:"premiere",title:"Adobe Premiere Pro 2026",pid:321,hwnd:501});
 const label=goalEvidenceLabel("Premiere kholo",windowGoalEvidence("Premiere kholo",observation,true));
 assert.match(label,/Only WINDOW existence independently verified/);
 assert.match(label,/project, edits, import, export.*UNVERIFIED/);
});
test("unrequested app, two matching windows, malformed identity cannot count as proof",()=>{
 assert.equal(windowGoalEvidence("Photoshop kholo",observation,true),null);
 assert.equal(windowGoalEvidence("Premiere kholo",{...observation,stdout:JSON.stringify([...windows,...windows])},true),null);
 assert.equal(windowGoalEvidence("Premiere kholo",{...observation,stdout:JSON.stringify([{Name:"Premiere"}])},true),null);
 assert.equal(windowGoalEvidence("Premiere kholo",{...observation,stdout:"broken"},true),null);
});

test("Batch 28 reject forged window title contradicting recognized process",()=>{
 const result={tool:"ui_windows",success:true,stdout:JSON.stringify([{Name:"Adobe Premiere Pro 2026",ProcessName:"Photoshop",ProcessId:111,NativeWindowHandle:222}])};
 assert.equal(windowGoalEvidence("Premiere kholo",result,true),null);
});
