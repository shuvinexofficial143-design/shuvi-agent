import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {strictlySimplePremiereOpening,strictlySimpleNotepadOpening,verifiedSimplePremiereOpening,
 verifiedSimpleNotepadOpening,verifiedSimpleOpening} from "../web-dashboard/src/native-opening-completion.mjs";
import {createTask,stageTask,executeTask,verifyTask,completeAuditedOpening,taskSummary} from "../web-dashboard/src/native-task-progress.mjs";

const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const windowResult=(rows=[
 {Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:533,NativeWindowHandle:15535}
])=>({tool:"ui_windows",success:true,stdout:JSON.stringify(rows),stderr:"",exit_code:0});
const evidence=()=>({audited:2,lastTool:"ui_windows",seenIds:new Set([A,B]),
 observations:[{id:A,tool:"premiere_launch",kind:"tool_execution"},{id:B,tool:"ui_windows",kind:"read_only"}]});
const check=(goal="Premiere kholo",result=windowResult(),e=evidence(),audited=true)=>
 verifiedSimplePremiereOpening(goal,B,result,e,audited);

test("strict entire-brief classifier recognizes only a simple Premiere opening",()=>{
 for(const goal of ["Premiere kholo","Premiere Pro kholo","premire kholo","Open Premiere",
 "Please open Adobe Premiere Pro","launch premiere pro","प्रीमियर खोलो",
 "प्रिमियर प्रो खोल दो","Premiere Pro kholo!"]){
  assert.equal(strictlySimplePremiereOpening(goal),true,goal);
 }
 for(const goal of [
 "Premiere kholo aur project banao", "Open Premiere and make a new project",
 "Open Premiere then WhatsApp","Open Premiere and edit video","Premiere export karo",
 "open Blender","Open After Effects","Premiere kholna","Open Premiere and run PowerShell",
 "Open Premiere; delete a file","Premiere खोलो और एडिट करो",""," ".repeat(140)
 ])assert.equal(strictlySimplePremiereOpening(goal),false,goal);
});
test("separate exact native launch and audited OS window read prove the narrow goal",()=>{
 const result=check();
 assert.deepEqual(result?.window,{app:"premiere",title:"Adobe Premiere Pro 2026",pid:533,hwnd:15535});
 assert.equal(result?.scope,"premiere_window");
 assert.equal(result?.launchActionId,A);
 assert.equal(result?.windowActionId,B);
});
test("no title-only proof when OS process identity is absent or foreign",()=>{
 for(const rows of [
 [{Name:"Adobe Premiere Pro",ProcessName:"",ProcessId:10,NativeWindowHandle:21}],
 [{Name:"Adobe Premiere Pro",ProcessName:"Notepad",ProcessId:10,NativeWindowHandle:21}],
 [{Name:"Adobe Premiere Pro",ProcessId:10,NativeWindowHandle:21}],
 [{Name:"Adobe Photoshop Premiere",ProcessName:"Adobe Premiere Pro",ProcessId:10,NativeWindowHandle:21}],
 [{Name:"Adobe Premiere Pro",ProcessName:"Adobe Premiere Pro",ProcessId:10,NativeWindowHandle:21},
  {Name:"Adobe Premiere Pro",ProcessName:"Adobe Premiere Pro",ProcessId:11,NativeWindowHandle:22}],
 []
 ])assert.equal(check("Premiere kholo",windowResult(rows)),null);
});
test("malformed/failing/unverified window observation never creates completed task",()=>{
 const result=windowResult();
 for(const altered of [
 {...result,success:false},{...result,exit_code:1},
 {...result,stdout:"invalid-json"}, {...result,stdout:"x".repeat(250001)},
 {...result,tool:"premiere_launch"}
 ])assert.equal(check("Premiere kholo",altered),null);
 assert.equal(check("Premiere kholo",result,evidence(),false),null);
});
test("existing window alone, unbound launcher, reused or reordered action UUID cannot close goal",()=>{
 for(const mutate of [
 e=>e.observations.shift(),
 e=>e.observations[0].tool="premiere_detect",
 e=>e.observations[0].id=B,
 e=>e.observations[1].id=A,
 e=>e.observations.reverse(),
 e=>e.seenIds.delete(A),
 e=>e.seenIds.delete(B),
 e=>e.lastTool="premiere_launch",
 e=>e.observations.push({id:"extra",tool:"ui_click"})
 ]){
  const e=evidence();mutate(e);
  assert.equal(check("Premiere kholo",windowResult(),e),null);
 }
 assert.equal(verifiedSimplePremiereOpening("Premiere kholo",A,windowResult(),evidence(),true),null);
});
test("Native UI progress records narrow window-only completion, not project/edit/export",()=>{
 let s=createTask();
 s=stageTask(s,A,"premiere_launch",1);
 s=executeTask(s,A);
 s=verifyTask(s,A,"premiere_launch",true);
 s=stageTask(s,B,"ui_windows",2);
 s=executeTask(s,B);
 s=verifyTask(s,B,"ui_windows",true);
 const complete=completeAuditedOpening(s);
 assert.equal(complete.phase,"window_verified");
 assert.match(taskSummary(complete),/window opening VERIFIED.*project\/edit\/export NOT verified/);
 assert.equal(completeAuditedOpening(createTask()).phase,"planning");
});
test("Native dashboard accepts only exact Rust audit and durably finalizes BEFORE terminal message",()=>{
 const ui=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(ui,/const simpleOpening=verified\?verifiedSimpleOpening\(/);
 assert.match(ui,/taskEvidence\.get\(current\.threadId\)\?\?null,true/);
 const capture=ui.indexOf("const simpleOpening=verified?");
 const checkpoint=ui.indexOf('await persistRecovery(finalBudget,"completed_verified",current.action.id)',capture);
 const finish=ui.indexOf("completeAuditedOpening(getTask(current.threadId),appName)",capture);
 const paid=ui.indexOf("await continueAfterVerifiedAction(current,result)",capture);
 assert.ok(capture>=0&&checkpoint>capture&&finish>checkpoint&&paid>finish);
 assert.match(ui,/if\(simpleOpening\|\|youtubeHome\)\{\s*const appName=[^\n]+;\s*const finalBudget/);
 assert.match(ui,/Project creation, file import, editing, save and export remain UNVERIFIED/);
});

test("Notepad opening is strictly scoped and recognizes Hindi without allowing extra work",()=>{
 for(const goal of ["Open Notepad","Please open Notepad","नोटपैड खोलो","कृपया नोटपैड खोल दो","Notepad kholo"])
  assert.equal(strictlySimpleNotepadOpening(goal),true,goal);
 for(const goal of ["notepad","Open Notepad and edit","नोटपैड खोलो और लिखो","Create a file in Notepad","Open Premiere"])
  assert.equal(strictlySimpleNotepadOpening(goal),false,goal);
});

test("Notepad needs a distinct audited launch_app and exact independent OS window",()=>{
 const observed=windowResult([{Name:"Untitled - Notepad",ProcessName:"notepad.exe",ProcessId:19444,NativeWindowHandle:5678}]);
 const proof={audited:2,lastTool:"ui_windows",seenIds:new Set([A,B]),observations:[
  {id:A,tool:"launch_app",kind:"tool_execution"},
  {id:B,tool:"ui_windows",kind:"read_only"}
 ]};
 const result=verifiedSimpleNotepadOpening("नोटपैड खोलो",B,observed,proof,true);
 assert.equal(result?.window.pid,19444);
 assert.equal(result?.window.hwnd,5678);
 assert.equal(result?.scope,"notepad_window");
 assert.deepEqual(verifiedSimpleOpening("नोटपैड खोलो",B,observed,proof,true),result);
 for(const bad of [
  [{Name:"Untitled - Notepad",ProcessName:"explorer.exe",ProcessId:19444,NativeWindowHandle:5678}],
  [{Name:"Untitled - Notepad",ProcessName:"",ProcessId:19444,NativeWindowHandle:5678}],
  [{Name:"Untitled - Notepad",ProcessName:"notepad.exe",ProcessId:19444,NativeWindowHandle:5678},
   {Name:"Untitled - Notepad",ProcessName:"notepad.exe",ProcessId:222,NativeWindowHandle:999}]
 ])assert.equal(verifiedSimpleNotepadOpening("नोटपैड खोलो",B,windowResult(bad),proof,true),null);
 assert.equal(verifiedSimpleNotepadOpening("नोटपैड खोलो",B,observed,proof,false),null);
 assert.equal(verifiedSimpleNotepadOpening("नोटपैड खोलो",A,observed,proof,true),null);
 assert.equal(verifiedSimpleNotepadOpening("Open Notepad and save",B,observed,proof,true),null);
});
