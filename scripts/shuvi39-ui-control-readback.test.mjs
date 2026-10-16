import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {newAuditedWindowObservation} from "../web-dashboard/src/native-window-observation-session.mjs";
import {newAuditedControlObservation,currentObservedControls,checkObservedControlTarget,MAX_CONTROL_AGE_MS} from "../web-dashboard/src/native-ui-control-session.mjs";
import {newPendingUiReadback,checkPendingUiReadback,auditUiReadback} from "../web-dashboard/src/native-ui-readback-session.mjs";

const A="action-1",B="action-2",C="action-3",T=10000,WIN="Adobe Premiere Pro 2026";
const windows=(pid=50,hwnd=900)=>({tool:"ui_windows",success:true,exit_code:0,
 stdout:JSON.stringify([{Name:WIN,ProcessId:pid,NativeWindowHandle:hwnd,ProcessName:"Premiere"}])});
const initial=()=>newAuditedWindowObservation(windows(),A,T);
const controls=[
 {Name:"New Project",AutomationId:"new_project",ControlType:"ControlType.Button",IsEnabled:true,IsOffscreen:false},
 {Name:"Save",AutomationId:"save",ControlType:"ControlType.Button",IsEnabled:true,IsOffscreen:false},
 {Name:"Opacity",AutomationId:"opacity",ControlType:"ControlType.Edit",IsEnabled:false,IsOffscreen:false},
 {Name:"Hidden",AutomationId:"hidden",ControlType:"ControlType.Button",IsEnabled:true,IsOffscreen:true}
];
const found=(rows=controls,patch={})=>({tool:"ui_discover",success:true,exit_code:0,stdout:JSON.stringify(rows),...patch});
const discover=(w=initial(),rows=controls)=>newAuditedControlObservation(found(rows),B,WIN,w,T+1000);
const action=(name,automation_id,window=WIN,tool="ui_click")=>({tool,arguments:{name,automation_id,window}});
const find=(window=WIN)=>({tool:"ui_discover",arguments:{window}});

test("audited discovery is bound to exactly observed HWND/PID and native action ID",()=>{
 const w=initial(),s=discover(w);
 assert.equal(s.sourceActionId,B);
 assert.equal(s.windowSourceActionId,A);
 assert.equal(s.hwnd,900);assert.equal(s.pid,50);assert.equal(s.title,WIN);
 assert.equal(s.controls.length,4);
 assert.equal(Object.isFrozen(s),true);
 assert.equal(Object.isFrozen(s.controls[0]),true);
 assert.equal(currentObservedControls(s,w,T+1500).length,4);
});
test("the unique exact UI AutomationId can be acted on only in the inspected window",()=>{
 const s=discover(),w=initial();
 assert.equal(checkObservedControlTarget(action("New Project","new_project"),s,w,T+2000).allowed,true);
 assert.equal(checkObservedControlTarget(action("Save","new_project"),s,w,T+2000).allowed,false);
 assert.equal(checkObservedControlTarget(action("Other","other"),s,w,T+2000).allowed,false);
 assert.equal(checkObservedControlTarget(action("New Project","new_project","Blender"),s,w,T+2000).allowed,false);
});
test("disabled and offscreen controls fail closed rather than force click",()=>{
 const w=initial(),s=discover(w);
 for(const a of [action("Opacity","opacity"),action("Hidden","hidden")])
  assert.equal(checkObservedControlTarget(a,s,w,T+2000).allowed,false);
});
test("duplicate labels require stable AutomationId rather than first-match",()=>{
 const w=initial(),s=discover(w,[
  {Name:"Save",AutomationId:"save_1",ControlType:"Button",IsEnabled:true},
  {Name:"Save",AutomationId:"save_2",ControlType:"Button",IsEnabled:true}
 ]);
 assert.equal(checkObservedControlTarget(action("Save",undefined),s,w,T+2000).allowed,false);
 assert.equal(checkObservedControlTarget(action("Save","save_2"),s,w,T+2000).allowed,true);
});
test("control observation expires after 45 seconds even while window observation remains fresh",()=>{
 const w=initial(),s=discover(w);
 assert.equal(MAX_CONTROL_AGE_MS,45000);
 assert.equal(currentObservedControls(s,w,T+1000+MAX_CONTROL_AGE_MS-1).length,4);
 assert.deepEqual(currentObservedControls(s,w,T+1000+MAX_CONTROL_AGE_MS),[]);
 assert.equal(checkObservedControlTarget(action("New Project","new_project"),s,w,T+1000+MAX_CONTROL_AGE_MS).allowed,false);
});
test("replaced window identity never reuses a control inventory by title alone",()=>{
 const w=initial(),s=discover(w);
 const changed=newAuditedWindowObservation(windows(55,901),C,T+2000);
 assert.equal(checkObservedControlTarget(action("New Project","new_project"),s,changed,T+3000).allowed,false);
 assert.equal(checkObservedControlTarget(action("New Project","new_project"),s,null,T+3000).allowed,false);
});
test("malformed discovery cannot mint UI authority and cannot be silently reused",()=>{
 const w=initial();
 for(const r of [found(controls,{success:false}),found(controls,{exit_code:1}),
   found(controls,{stdout:"not json"}),found([]),found(controls,{stdout:"a".repeat(250001)})]){
  assert.equal(newAuditedControlObservation(r,B,WIN,w,T+1000),null);
 }
 assert.equal(checkObservedControlTarget(action("New Project","new_project"),null,w,T+2000).allowed,false);
});
test("no prior UIA discovery preserves already restricted Rust selector matching",()=>{
 assert.equal(checkObservedControlTarget(action("New Project","new_project"),undefined,initial(),T+2000).allowed,true);
});
test("audited mutation requires UIA readback before any second mutation",()=>{
 const w=initial(),p=action("New Project","new_project");
 const pending=newPendingUiReadback(C,p,w,T+2000);
 assert.equal(pending.sourceActionId,C);assert.equal(pending.hwnd,900);
 assert.equal(checkPendingUiReadback(action("Save","save"),pending).allowed,false);
 assert.equal(checkPendingUiReadback(find(),pending).allowed,true);
 assert.equal(checkPendingUiReadback({tool:"ui_windows",arguments:{}},pending).allowed,true);
});
test("an ordinary window listing does not certify a clicked control changed",()=>{
 const w=initial(),pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 assert.equal(auditUiReadback(pending,{tool:"ui_windows",arguments:{}},windows(),w,T+3000),pending);
});
test("matching independently audited UIA inspection may close readback requirement, not claim desired effect",()=>{
 const w=initial(),pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 assert.equal(auditUiReadback(pending,find(),found(),w,T+3000),null);
 assert.equal(checkPendingUiReadback(action("Save","save"),null).allowed,true);
});
test("foreign or reassigned HWND and empty control result cannot clear mutation readback",()=>{
 const w=initial(),pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 const foreign=newAuditedWindowObservation(windows(51,901),B,T+2100);
 assert.equal(auditUiReadback(pending,find(),found(),foreign,T+3000),pending);
 assert.equal(auditUiReadback(pending,find("Blender"),found(),w,T+3000),pending);
 assert.equal(auditUiReadback(pending,find(),found([]),w,T+3000),pending);
 assert.equal(auditUiReadback(pending,find(),found(controls,{success:false}),w,T+3000),pending);
});
test("screen and ui_windows remain independent of control-name selector gate",()=>{
 const w=initial(),s=discover(w);
 assert.equal(checkObservedControlTarget({tool:"ui_windows",arguments:{}},s,w,T+2000).allowed,true);
 assert.equal(checkObservedControlTarget({tool:"inspect_screen",arguments:{window:WIN}},s,w,T+2000).allowed,true);
});
test("native execution wiring rechecks observation after owner approval and before execute_action",()=>{
 const src=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const before=src.indexOf("Approvals may sit");
 const execute=src.indexOf('await invoke<ActionResult>("execute_action"');
 assert.ok(before>0&&execute>before);
 assert.match(src.slice(before,execute),/nativeControlGate\(current.threadId,current.proposal\)/);
 assert.match(src.slice(before,execute),/nativeReadbackGate\(current.threadId,current.proposal\)/);
 assert.match(src,/newAuditedControlObservation\(/);
 assert.match(src,/pendingUiReadback.set\(current.threadId,newPendingUiReadback/);
 assert.match(src,/auditUiReadback\(/);
});

test("native keyboard fallback also requires exact observed control and rejects offscreen or wrong window",()=>{
 const w=initial(),s=discover(w);
 assert.equal(checkObservedControlTarget(action("New Project","new_project",WIN,"ui_send_keys"),s,w,T+2000).allowed,true);
 assert.equal(checkObservedControlTarget(action("Hidden","hidden",WIN,"ui_send_keys"),s,w,T+2000).allowed,false);
 assert.equal(checkObservedControlTarget(action("New Project","wrong_id",WIN,"ui_send_keys"),s,w,T+2000).allowed,false);
 assert.equal(checkObservedControlTarget(action("New Project","new_project","Another Window","ui_send_keys"),s,w,T+2000).allowed,false);
});

test("native ui_find singleton JSON closes only matching same-HWND independent readback",()=>{
 const w=initial();
 const pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 const proposal={tool:"ui_find",arguments:{window:WIN,name:"New Project",automation_id:"new_project"}};
 const result={tool:"ui_find",success:true,exit_code:0,
  stdout:JSON.stringify(controls[0])};
 assert.equal(auditUiReadback(pending,proposal,result,w,T+3000),null);
});
test("native singleton ui_find cannot clear readback with mismatched selector or window",()=>{
 const w=initial();
 const pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 const proposal={tool:"ui_find",arguments:{window:WIN,name:"New Project",automation_id:"new_project"}};
 const result={tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify(controls[1])};
 assert.equal(auditUiReadback(pending,proposal,result,w,T+3000),pending);
 assert.equal(auditUiReadback(pending,{...proposal,arguments:{...proposal.arguments,window:"Blender"}},
  {...result,stdout:JSON.stringify(controls[0])},w,T+3000),pending);
 assert.equal(auditUiReadback(pending,proposal,{...result,success:false,stdout:JSON.stringify(controls[0])},w,T+3000),pending);
});
test("ui_discover singleton object cannot masquerade as correctly serialized UI inventory",()=>{
 const w=initial();
 const pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 assert.equal(auditUiReadback(pending,find(),{
  tool:"ui_discover",success:true,exit_code:0,stdout:JSON.stringify(controls[0])
 },w,T+3000),pending);
});
test("ui_find readback requires a requested selector and a nonempty actual control identity",()=>{
 const w=initial();
 const pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 const proposal={tool:"ui_find",arguments:{window:WIN}};
 const result={tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify(controls[0])};
 assert.equal(auditUiReadback(pending,proposal,result,w,T+3000),pending);
 assert.equal(auditUiReadback(pending,{...proposal,arguments:{window:WIN,name:"New Project"}},
  {...result,stdout:JSON.stringify({Name:"",AutomationId:""})},w,T+3000),pending);
});

test("generic discovery of unrelated controls never clears readback for the actual mutated control",()=>{
 const w=initial(),pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 const unrelated=found([controls[1]]);
 assert.equal(auditUiReadback(pending,find(),unrelated,w,T+3000),pending);
});
test("two controls with the same original selector are ambiguous even in an audited discovery",()=>{
 const w=initial(),pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 assert.equal(auditUiReadback(pending,find(),found([controls[0],controls[0]]),w,T+3000),pending);
});
test("ui_find may return exactly one original control, but a second response row is not an exact proof",()=>{
 const w=initial(),pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 const proposal={tool:"ui_find",arguments:{window:WIN,name:"New Project",automation_id:"new_project"}};
 const response={tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify([controls[0],controls[1]])};
 assert.equal(auditUiReadback(pending,proposal,response,w,T+3000),pending);
});
test("malformed native control role or state cannot clear audited readback",()=>{
 const w=initial(),pending=newPendingUiReadback(C,action("New Project","new_project"),w,T+2000);
 for(const c of [{...controls[0],IsEnabled:"yes"},
                 {...controls[0],IsOffscreen:"false"},
                 {...controls[0],ControlType:7},
                 {...controls[0],ControlType:"x".repeat(101)}]){
  assert.equal(auditUiReadback(pending,find(),found([c]),w,T+3000),pending);
 }
});
test("native ui_find exposes bounded independent state without leaking field or password values",()=>{
 const source=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 const begin=source.indexOf("        ToolAction::UiFind {",550000),end=source.indexOf("        ToolAction::UiClick {",begin);
 assert.ok(begin>=0&&end>begin);
 const read=source.slice(begin,end);
 for(const field of ["ToggleState","ExpandCollapseState","HasKeyboardFocus","VerticalScrollPercent","IsSelected","IsOffscreen"])
  assert.match(read,new RegExp(field+" = "));
 assert.doesNotMatch(read,/(?:ValuePattern\]\$p\)\.Current\.Value|Password\s*=|Value\s*=\s*\$e)/);
 assert.match(read,/ConvertTo-Json -Compress/);
});
