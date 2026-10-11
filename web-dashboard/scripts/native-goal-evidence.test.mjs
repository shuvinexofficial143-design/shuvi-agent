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

test("Batch 41 oversized UI evidence cannot mark an app window verified",()=>{
 const huge={tool:"ui_windows",success:true,stdout:"["+" ".repeat(250001)+"]"};
 assert.equal(windowGoalEvidence("Premiere kholo",huge,true),null);
});

test("Batch 50 conflicting records sharing a HWND cannot verify a live application",()=>{
 const contradiction={tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Adobe Premiere Pro 2026",ProcessName:"Premiere",ProcessId:12,NativeWindowHandle:5},
  {Name:"Adobe Photoshop 2026",ProcessName:"Photoshop",ProcessId:13,NativeWindowHandle:5}
 ])};
 assert.equal(windowGoalEvidence("Premiere kholo",contradiction,true),null);
});

test("Batch 54 independently verified window proof displays normalized safe title",()=>{
 const result={tool:"ui_windows",success:true,stdout:JSON.stringify([
  {Name:"Adobe Premiere\u202e Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:120,NativeWindowHandle:121}
 ])};
 const proof=windowGoalEvidence("Premiere kholo",result,true);
 assert.ok(proof);
 assert.equal(proof.title,"Adobe Premiere Pro 2026");
 assert.doesNotMatch(goalEvidenceLabel("Premiere kholo",proof),/[\u202a-\u202e]/);
});

test("Batch 57 newly scoped Adobe tools only verify their own unique audited live window",()=>{
 for(const [name,process,app] of [
  ["Media Encoder","Adobe Media Encoder","media-encoder"],
  ["Adobe Animate","Adobe Animate","animate"],
  ["Character Animator","Adobe Character Animator","character-animator"],
  ["Substance 3D","Adobe Substance 3D","substance-3d"],
  ["Frame.io","Frame.io","frameio"]
 ]){
  const result={tool:"ui_windows",success:true,stdout:JSON.stringify([
   {Name:process+" 2026",ProcessName:process,ProcessId:55,NativeWindowHandle:77}])};
  assert.equal(windowGoalEvidence("Open "+name,result,true)?.app,app);
  assert.equal(windowGoalEvidence("Open "+name,result,false),null);
 }
});
