import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const entry=fileURLToPath(new URL("../web-dashboard/src/native-agent.ts",import.meta.url));
const {outputFiles}=await build({
 entryPoints:[entry],bundle:true,platform:"node",format:"esm",target:"node22",write:false,
 plugins:[{name:"native-model-stub",setup(builder){
  builder.onResolve({filter:/^\.\/native-model-setup$/},()=>({path:"model",namespace:"stub"}));
  builder.onLoad({filter:/.*/,namespace:"stub"},()=>({
   contents:'export function mountNativeModelSetup(){return {current:()=>({provider:"xkiro",base_url:"",roles:{chat:"model/chat",master:"model/master",premiere:"model/premiere"}})}}',
   loader:"js"
  }));
 }}]
});
const {mountNativeAgent}=await import("data:text/javascript;base64,"+
 Buffer.from(outputFiles[0].text).toString("base64"));
function el(){
 return {
  textContent:"",hidden:false,disabled:false,value:"",
  className:"",children:[],listeners:new Map(),attributes:{},
  parentElement:null,classList:{toggle(){return true}},
  setAttribute(name,value){this.attributes[name]=value;},
  addEventListener(name,fn){this.listeners.set(name,fn);},
  append(...children){this.children.push(...children);},
  insertBefore(child){this.children.push(child);},
  scrollIntoView(){},focus(){}
 };
}
const detectedPath="C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe";
const detection={
 content:JSON.stringify({tool:"premiere_detect",arguments:{}}),
 provider:"xkiro",model:"model/master",
 tool_proposal:{tool:"premiere_detect",arguments:{}}
};
const launch={
 content:JSON.stringify({tool:"premiere_launch",arguments:{}}),
 provider:"xkiro",model:"model/master",
 tool_proposal:{tool:"premiere_launch",arguments:{}}
};
function setup({first=detection,second=launch,following=[],auditOk=true,failFind=false,softFailedRead=false,receiptMismatch=false,conflictingSuccessAudit=false,stdoutFor=null,wrongStageIndex=0,continuationRenderError=false}={}){
 const nodes=new Map(),created=[],calls=[],chatInputs=[],staged=[];
 const domParent=el(),composerParent=el(),form=el(),chat=el();
 form.parentElement=composerParent;chat.parentElement=domParent;
 nodes.set("chatWorkspaceLayout",chat);nodes.set("chatForm",form);
 globalThis.document={
  getElementById(id){return nodes.get(id)??null},
  createElement(){const e=el();created.push(e);return e},
  querySelector(){return null}
 };
 const replies=[first,second,...following];
 const invoke=async(name,params={})=>{
  calls.push({name,params});
  if(name==="runtime_status")return {shuvi_memory_mb:40,managed_children_count:0};
  if(name==="list_providers")return [{id:"xkiro",name:"xKiro"}];
  if(name==="remote_agent_status")return {enabled:false};
  if(name==="chat"){
   chatInputs.push(params.input);
   const response=replies.shift()??{content:"Done",tool_proposal:null};
   if(continuationRenderError&&chatInputs.length===2){
    let reads=0;
    return {...response,get content(){reads++;if(reads>1)throw Error("UI lookup failed: synthetic continuation render failure");return "continue";}};
   }
   return response;
  }
  if(name==="prepare_tool"){
   const id="action-"+(staged.length+1);
   staged.push({id,proposal:params.proposal});
   return {id,kind:staged.length===wrongStageIndex?"wrong_tool":params.proposal.tool,
    summary:"Run "+params.proposal.tool,detail:"Approval needed",risk:"medium"};
  }
  if(name==="execute_action"){
   const action=staged.find(s=>s.id===params.actionId);
   if(!action)throw Error("unexpected action ID");
   if(failFind&&action.proposal.tool==="ui_find")
    throw Error("UI lookup failed: Requested top-level window was not found.");
   if(softFailedRead&&action.proposal.tool==="ui_find")
    return {success:false,tool:"ui_find",stdout:"",stderr:"UI lookup failed: No matching UI element found",exit_code:1};
   return {success:true,tool:action.proposal.tool,stdout:stdoutFor?.[action.proposal.tool]??(action.proposal.tool==="premiere_detect"?detectedPath:"Launch requested"),stderr:"",exit_code:0};
  }
  if(name==="action_audit_receipt")
   return (failFind||softFailedRead)?{action_id:receiptMismatch?"mismatched-action":params.actionId,tool:"ui_find",event:"failed",success:false}:null;
  if(name==="audit_log")return auditOk?staged.map(s=>{
   const failed=softFailedRead&&s.proposal.tool==="ui_find"&&!conflictingSuccessAudit;
   return {event:failed?"failed":"executed",action_id:s.id,tool:s.proposal.tool,success:!failed};
  }):[];
  if(name==="deny_action")return;
  throw Error("unexpected native call: "+name);
 };
 globalThis.window={__TAURI_INTERNALS__:{invoke}};
 const transport=mountNativeAgent(()=>{});
 const allow=created.find(x=>x.textContent==="Allow once");
 const deny=created.find(x=>x.textContent==="Deny");
 const approval=created.find(x=>x.attributes["aria-label"]==="Windows action needs your approval");
 return {transport,calls,chatInputs,staged,allow,deny,approval};
}
async function until(predicate,label){
 for(let i=0;i<80;i++){
  if(predicate())return;
  await new Promise(resolve=>setImmediate(resolve));
 }
 assert.fail("Timed out waiting for "+label);
}
test("A direct Premiere open request tells Master to launch, not only discover, with explicit approval",async()=>{
 const s=setup({first:launch});
 await until(()=>s.transport.connected(),"IPC");
 const reply=await s.transport.send("Premiere Pro kholo","direct-premiere",0);
 assert.equal(reply.ok,true);
 assert.equal(s.chatInputs.length,1,"no additional paid call before first approval");
 assert.equal(s.chatInputs[0].model,"model/master");
 assert.match(s.chatInputs[0].orchestration_context,/premiere_launch with \{\} FIRST/);
 assert.match(s.chatInputs[0].orchestration_context,/Do not stop at premiere_detect/);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"premiere_launch");
 assert.deepEqual(s.staged[0].proposal.arguments,{});
 assert.equal(s.approval.hidden,false);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
});
test("short app-name clarification retains the previous open request as Master context",async()=>{
 const clarification={content:"कौन-सा Adobe ऐप खोलूँ?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:clarification,second:launch});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("adobe open karo","clarify",0);
 await s.transport.send("Premiere Pro","clarify",1);
 assert.equal(s.chatInputs[1].model,"model/master");
 assert.match(s.chatInputs[1].orchestration_context,/previous opening request: adobe open karo/);
 assert.equal(s.staged[0].proposal.tool,"premiere_launch");
});

test("Premiere: discovery audit triggers one Master continuation and a SECOND explicit launch approval",async()=>{
 const s=setup();
 await until(()=>s.transport.connected(),"native IPC");
 const reply=await s.transport.send("Adobe open karo. Premiere Pro","chat-1",0);
 assert.equal(reply.ok,true);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"premiere_detect");
 assert.equal(s.approval.hidden,false);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"second prepared step");
 assert.equal(s.staged[1].proposal.tool,"premiere_launch");
 assert.deepEqual(s.staged[1].proposal.arguments,{});
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,
  "second app action must NOT run before another Allow once");
 assert.equal(s.approval.hidden,false,"next approval survives previous-step finally");
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.chatInputs[0].model,"model/master");
 assert.equal(s.chatInputs[1].model,"model/master");
 assert.match(s.chatInputs[1].messages.at(-1).content,/Previously approved Windows tool/);
 assert.match(s.chatInputs[1].messages.at(-1).content,/Adobe Premiere Pro\.exe/);
 assert.match(s.transport.getReplies("chat-1")[0],/Master next step/);
});
test("missing audit stops after first action and never calls model again",async()=>{
 const s=setup({auditOk:false});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Open Premiere Pro","c2",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"approval cleanup");
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.staged.length,1);
 assert.match(s.transport.getReplies("c2")[0],/not independently verified/);
});
test("user denial stops; no follow-up AI or Windows action",async()=>{
 const s=setup();
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Open Premiere Pro","c3",0);
 s.deny.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"denial cleanup");
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.calls.some(x=>x.name==="execute_action"),false);
});
test("repeated identical proposal is blocked instead of staged or executed",async()=>{
 const s=setup({second:detection});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Open Premiere Pro","c4",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("c4")[0]?.includes("identical action"),"duplicate block");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
});

test("short answer to Master clarification stays on Master, never drops into normal Chat",async()=>{
 const prompt={content:"कौन-सा Adobe ऐप खोलूँ? Premiere Pro या Photoshop?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:prompt,second:detection});
 await until(()=>s.transport.connected(),"IPC");
 const first=await s.transport.send("Adobe open karo","choice-thread",0);
 assert.equal(first.ok,true);
 assert.equal(s.staged.length,0);
 const second=await s.transport.send("Premiere Pro","choice-thread",1);
 assert.equal(second.ok,true);
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.chatInputs[0].model,"model/master");
 assert.equal(s.chatInputs[1].model,"model/master",
  "single app name is the answer to prior Master clarification");
 assert.equal(s.chatInputs[1].messages.at(-1).content,"Premiere Pro");
 assert.equal(s.staged[0].proposal.tool,"premiere_detect");
 assert.equal(s.approval.hidden,false);
});

test("eight distinct stages have no fixed six-action cutoff",async()=>{
 const action=(i)=>({content:JSON.stringify({tool:"ui_find",arguments:{target:"window-"+i}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_find",arguments:{target:"window-"+i}}});
 const s=setup({first:detection,second:action(2),
  following:[action(3),action(4),action(5),action(6),action(7),action(8)]});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Open Premiere and check the necessary windows","long-task",0);
 for(let step=1;step<=7;step++){
  await until(()=>s.staged.length===step,"stage "+step);
  await until(()=>s.allow.disabled===false,"approval "+step);
  assert.equal(s.approval.hidden,false);
  assert.equal(s.calls.filter(x=>x.name==="execute_action").length,step-1);
  s.allow.listeners.get("click")();
  await until(()=>s.staged.length===step+1,"next stage "+(step+1));
 }
 assert.equal(s.staged.length,8);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,7);
 assert.equal(s.chatInputs.length,8);
 assert.equal(s.approval.hidden,false);
 assert.doesNotMatch(s.transport.getReplies("long-task")[0],/step safety limit/);
});

test("Premiere opening has separate detect, launch and window-inspection approvals",async()=>{
 const inspect={content:JSON.stringify({tool:"ui_find",arguments:{name:"Adobe Premiere Pro"}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_find",arguments:{name:"Adobe Premiere Pro"}}};
 const s=setup({following:[inspect]});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Premiere Pro kholo","premiere-inspect",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"Premiere launch approval");
 assert.equal(s.staged[1].proposal.tool,"premiere_launch");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 await until(()=>s.allow.disabled===false,"second action approval ready");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"Premiere window inspection approval");
 assert.equal(s.staged[2].proposal.tool,"ui_find");
 assert.deepEqual(s.staged[2].proposal.arguments,{name:"Adobe Premiere Pro"});
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2,
  "window inspection must NOT happen before a third approval");
 assert.equal(s.approval.hidden,false);
 assert.match(s.chatInputs[2].messages.at(-1).content,/Launching a process is not evidence/);
});

test("audited failed read-only UI lookup stages window recovery without paying AI again",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Adobe Premiere Pro"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Adobe Premiere Pro"}}};
 const s=setup({first:finding,failFind:true});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Create Premiere project","repair-ui",0);
 assert.equal(s.staged.length,1);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"read-only recovery");
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.chatInputs.length,1,"no second paid model request before recovery approval");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,"no unapproved recovery execution");
 assert.equal(s.approval.hidden,false);
 assert.match(s.transport.getReplies("repair-ui")[0],/No automatic paid AI retry/);
});

test("Master receives actionable controls from deep inside a long UI discovery list",async()=>{
 const entries=Array.from({length:110},(_,i)=>({
  Name:i===90?"New Project":"Feature "+i,
  AutomationId:i===90?"createProject":"feature-"+i,
  ControlType:"ControlType.Button",IsEnabled:true,Bounds:"0,0,60,20",ClassName:"Button"
 }));
 const discovering={content:JSON.stringify({tool:"ui_discover",arguments:{window:"Adobe Premiere"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_discover",arguments:{window:"Adobe Premiere"}}};
 const s=setup({first:discovering,stdoutFor:{ui_discover:JSON.stringify(entries)}});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Create a Premiere Project","observed-ui",0);
 s.allow.listeners.get("click")();
 await until(()=>s.chatInputs.length===2,"Master continuation with discovery inventory");
 const next=s.chatInputs[1].messages.at(-1).content;
 assert.match(next,/New Project/);
 assert.match(next,/createProject/);
 assert.match(next,/"role":"Button"/);
 assert.match(next,/untrusted observed data/);
 assert.ok(next.length<=10800,"prevent unbounded provider input");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
});


test("Premiere creation objective survives audited launch and is not mistaken for a finished task",async()=>{
 const inspect={content:JSON.stringify({tool:"ui_windows",arguments:{}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:launch,second:inspect});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premire kholo aur Shuvi AI Test 01 naam ka project banao","project-create",0);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"premiere_launch");
 assert.match(s.chatInputs[0].orchestration_context,/Premiere project creation is an END GOAL/);
 assert.match(s.chatInputs[0].orchestration_context,/exact user-requested name/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"verified next step");
 assert.match(s.chatInputs[1].orchestration_context,/Premiere project creation is an END GOAL/);
 assert.match(s.chatInputs[1].orchestration_context,/Current approved step: 1/);
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,
  "the next readback action still requires separate approval");
 assert.equal(s.approval.hidden,false);
});

test("app choice preserves original named project through native approval and follow-up",async()=>{
 const clarification={content:"कौन-सा Adobe ऐप खोलूँ?",provider:"xkiro",
  model:"model/master",tool_proposal:null};
 const inspection={content:JSON.stringify({tool:"ui_windows",arguments:{}}),provider:"xkiro",
  model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:clarification,second:launch,following:[inspection]});
 await until(()=>s.transport.connected(),"native app ready");
 await s.transport.send("Adobe खोलकर Shuvi AI Test 01 नाम का नया प्रोजेक्ट बनाओ","choice-project",0);
 assert.equal(s.staged.length,0);
 await s.transport.send("Premiere Pro","choice-project",1);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"premiere_launch");
 assert.match(s.chatInputs[1].orchestration_context,/Premiere project creation is an END GOAL/);
 assert.match(s.chatInputs[1].orchestration_context,/Shuvi AI Test 01/);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"audited window verification");
 assert.match(s.chatInputs[2].orchestration_context,/Shuvi AI Test 01/);
 assert.match(s.chatInputs[2].orchestration_context,/Premiere Pro/);
 assert.match(s.chatInputs[2].messages.at(-1).content,/^Original user request:/);
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,false);
});
test("Master's prose-only completion claim remains visibly unverified",async()=>{
 const claimed={content:"The project was created successfully",provider:"xkiro",
  model:"model/master",tool_proposal:null};
 const s=setup({first:launch,second:claimed});
 await until(()=>s.transport.connected(),"native app ready");
 await s.transport.send("Premiere kholo aur new project banao","unverified-finish",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("unverified-finish")[0]?.includes("NOT independently verified complete"),
  "honest pause");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
});

test("next Master proposal sees one audited step but still needs a new Allow once",async()=>{
 const inspect={content:JSON.stringify({tool:"ui_windows",arguments:{}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:launch,second:inspect});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere kholo aur project banao","progress-task",0);
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"next permission");
 assert.match(s.chatInputs[1].orchestration_context,/1 audited native step\(s\)/);
 assert.match(s.chatInputs[1].orchestration_context,/Verified tools: premiere_launch/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,false);
});

test("typed unsuccessful read-only ui_find result stages audited ui_windows without paid retry",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}};
 const s=setup({first:finding,softFailedRead:true});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Find new project in Premiere","typed-ui-failure",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"typed failure recovery proposal");
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.chatInputs.length,1,"no additional paid Master request");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,
  "read-only recovery still needs separate explicit approval");
 assert.equal(s.approval.hidden,false);
 assert.match(s.transport.getReplies("typed-ui-failure")[0],/verified native failure receipt/);
});
test("typed failure with mismatched native receipt never stages recovery or paid retry",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}};
 const s=setup({first:finding,softFailedRead:true,receiptMismatch:true});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Find new project in Premiere","bad-receipt",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"recovery rejected");
 assert.equal(s.staged.length,1);
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.match(s.transport.getReplies("bad-receipt")[0],/No automatic retry/);
});

test("conflicting successful audit on typed failure blocks read-only recovery",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}};
 const s=setup({first:finding,softFailedRead:true,conflictingSuccessAudit:true});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Find new project in Premiere","contradictory-audit",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"contradictory audit blocked");
 assert.equal(s.staged.length,1);
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.calls.filter(x=>x.name==="action_audit_receipt").length,0);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.match(s.transport.getReplies("contradictory-audit")[0],/No automatic retry/);
});

test("verified UI recovery observation causes grounded replan advice, not a blind click",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Adobe Premiere Pro"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Adobe Premiere Pro"}}};
 const discovery={content:JSON.stringify({tool:"ui_discover",arguments:{window:"Adobe Premiere Pro"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_discover",arguments:{window:"Adobe Premiere Pro"}}};
 const s=setup({first:finding,second:discovery,failFind:true,
  stdoutFor:{ui_windows:JSON.stringify([{Name:"Adobe Premiere Pro 2026",ProcessId:3500,ProcessName:"Adobe Premiere Pro",NativeWindowHandle:909}])}});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere me New Project banao","safe-replan",0);
 assert.equal(s.staged.length,1);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"recovery windows stage");
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.chatInputs.length,1,"confirmed failed ui_find does not trigger paid call");
 await until(()=>s.allow.disabled===false,"recovery permission");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"new grounded inspection stage");
 assert.equal(s.chatInputs.length,2,"only after separately approved and audited ui_windows");
 assert.match(s.chatInputs[1].orchestration_context,/Recovery planning: an earlier ui_find/);
 assert.match(s.chatInputs[1].orchestration_context,/Do not repeat the unsuccessful selector/);
 assert.match(s.chatInputs[1].messages.at(-1).content,/Adobe Premiere Pro 2026/);
 assert.equal(s.staged[2].proposal.tool,"ui_discover");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2);
 assert.equal(s.approval.hidden,false);
});

test("same Master action with reordered argument keys is blocked before staging",async()=>{
 const first={content:"find",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{window:"Premiere",name:"New Project"}}};
 const second={content:"find again",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}};
 const s=setup({first,second});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Look for New Project in Premiere","canonical-duplicate",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("canonical-duplicate")[0]?.includes("identical action"),
  "duplicate proposal rejected");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.chatInputs.length,2,"no paid retry after repeated proposal");
});
test("a fresh read-only UI inspection after audited mutation is allowed once",async()=>{
 const windows={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const click={content:"click",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Premiere",name:"New Project"}}};
 const windowsAgain={content:"inspect changed UI",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const repeatedWindows={content:"inspect same unchanged UI",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:windows,second:click,following:[windowsAgain,repeatedWindows],
  stdoutFor:{ui_windows:JSON.stringify([{Name:"Premiere",ProcessId:100,NativeWindowHandle:101,ProcessName:"Adobe Premiere Pro"}])}});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Inspect Premiere, click New Project, and verify window","reobserve-after-change",0);
 assert.equal(s.staged[0].proposal.tool,"ui_windows");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"mutation proposed");
 assert.equal(s.staged[1].proposal.tool,"ui_click");
 await until(()=>!s.allow.disabled,"mutation approval");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"read-after-mutation proposed");
 assert.equal(s.staged[2].proposal.tool,"ui_windows");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2,
  "reobservation requires a fresh approval");
 await until(()=>!s.allow.disabled,"reobservation approval");
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("reobserve-after-change")[0]?.includes("identical action"),
  "second unchanged read stopped");
 assert.equal(s.staged.length,3);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,3);
 assert.equal(s.chatInputs.length,4);
});

test("Batch 07 invalid provider tool is blocked BEFORE native preparation",async()=>{
 const invalid={content:"not a valid tool",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{payload:"x".repeat(20000)}}};
 const s=setup({first:invalid});
 await until(()=>s.transport.connected(),"ready");
 const outcome=await s.transport.send("Click the observed button","bad-proposal",0);
 assert.equal(outcome.ok,true,"paid reply already received, no automatic paid retry");
 assert.equal(s.calls.filter(c=>c.name==="prepare_tool").length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 assert.equal(s.approval.hidden,true);
 assert.match(s.transport.getReplies("bad-proposal")[0],/preparation failed/);
});
test("Batch 07 first mismatched Rust prepared tool cannot create approval",async()=>{
 const s=setup({first:launch,wrongStageIndex:1});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("Open Premiere","wrong-initial-kind",0);
 assert.equal(s.calls.filter(c=>c.name==="prepare_tool").length,1);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 assert.equal(s.approval.hidden,true);
 assert.match(s.transport.getReplies("wrong-initial-kind")[0],/tool preparation failed or its outcome is unknown/);
});
test("Batch 07 continuation rejects mismatched prepared kind after audited first step",async()=>{
 const read={content:'{"tool":"ui_windows","arguments":{}}',provider:"xkiro",
  model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:launch,second:read,wrongStageIndex:2});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("Open Premiere and inspect window","wrong-followup-kind",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("wrong-followup-kind")[0]?.includes("Next Windows tool preparation failed"),
  "mismatch fail closed");
 assert.equal(s.staged.length,2,"Rust mocked staging was reached but mismatched tool was never approved");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,true);
 assert.equal(s.chatInputs.length,2);
});

test("Batch 08 multi-turn app and folder clarification retains original goal",async()=>{
 const app={content:"कौन-सा Adobe ऐप खोलूँ?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const destination={content:"Where should I save the new project?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:app,second:destination,following:[launch]});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Adobe खोलकर Shuvi AI Test 01 नाम का नया प्रोजेक्ट बनाओ","multi-clarification",0);
 await s.transport.send("Premiere Pro","multi-clarification",1);
 await s.transport.send("D:\\Projects\\Test","multi-clarification",2);
 assert.equal(s.chatInputs.length,3);
 assert.equal(s.chatInputs[2].model,"model/master");
 assert.match(s.chatInputs[2].orchestration_context,/Adobe खोलकर Shuvi AI Test 01/);
 assert.match(s.chatInputs[2].orchestration_context,/Premiere Pro/);
 assert.match(s.chatInputs[2].orchestration_context,/Projects/);
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 assert.equal(s.approval.hidden,false);
});
test("Batch 08 fresh command does not inherit older clarification goal",async()=>{
 const app={content:"कौन-सा Adobe ऐप खोलूँ?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:app,second:launch});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Adobe खोलकर Shuvi Test नाम का प्रोजेक्ट बनाओ","fresh-after-choice",0);
 await s.transport.send("Photoshop खोलो","fresh-after-choice",1);
 assert.equal(s.chatInputs.length,2);
 assert.doesNotMatch(s.chatInputs[1].orchestration_context,/Shuvi Test/);
 assert.equal(s.staged.length,1);
});

test("Batch 09 model continuation sees audit-only evidence and still requires next approval",async()=>{
 const s=setup({first:launch,second:{content:"inspect",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere open aur new project banao","evidence-b9",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"next step");
 assert.match(s.chatInputs[1].orchestration_context,/1 audited native action/);
 assert.match(s.chatInputs[1].orchestration_context,/Overall application\/task goals NOT independently verified/);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,false);
});

test("Batch 10 verified Windows inventory explicitly flags identity ambiguity before next approval",async()=>{
 const inspect={content:"inspect",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_discover",arguments:{window:"Premiere"}}};
 const windows={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const stdout=JSON.stringify([
  {Name:"Adobe Premiere Pro 2026",ProcessId:111,ProcessName:"Premiere",NativeWindowHandle:501},
  {Name:"Adobe Premiere Pro 2026",ProcessId:222,ProcessName:"Premiere",NativeWindowHandle:502}
 ]);
 const s=setup({first:windows,second:inspect,stdoutFor:{ui_windows:stdout}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere ko dekho","multi-window-evidence",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"second approval");
 assert.match(s.chatInputs[1].orchestration_context,/2 usable window identity/);
 assert.match(s.chatInputs[1].orchestration_context,/NOT a selected target/);
 assert.match(s.chatInputs[1].orchestration_context,/never pick the first matching window/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
});

test("Batch 11 post-action save-folder clarification retains the ORIGINAL goal",async()=>{
 const question={content:"Where should I save the project?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const next={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:launch,second:question,following:[next]});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Premiere kholo aur Shuvi AI Test project banao","clarification-after-tool",0);
 s.allow.listeners.get("click")();
 await until(()=>s.chatInputs.length===2,"Master destination question");
 await until(()=>s.transport.getReplies("clarification-after-tool")[0]?.includes("Task paused"),
  "paused for owner choice");
 await s.transport.send("D:\\Temporary Projects","clarification-after-tool",1);
 assert.equal(s.chatInputs[2].model,"model/master");
 assert.match(s.chatInputs[2].orchestration_context,/Premiere kholo aur Shuvi AI Test/);
 assert.match(s.chatInputs[2].orchestration_context,/Temporary Projects/);
 assert.equal(s.staged.length,2);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
});
test("Batch 11 no-tool final answer clears old clarification identity",async()=>{
 const question={content:"Which Adobe app should I open?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const done={content:"All set!",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:question,second:done,following:[launch]});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Adobe kholo aur Shuvi Test project banao","scope-expiration",0);
 await s.transport.send("Premiere Pro","scope-expiration",1);
 await s.transport.send("Something else","scope-expiration",2);
 assert.doesNotMatch(s.chatInputs[2].orchestration_context??"",/Shuvi Test/);
});

test("Batch 13 blocks cross-app model click after audited Premiere window read",async()=>{
 const first={content:"windows",provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const second={content:"click",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Photoshop 2026",name:"New"}}};
 const s=setup({first,second,stdoutFor:{ui_windows:JSON.stringify([
  {Name:"Adobe Premiere Pro 2026",ProcessId:200,NativeWindowHandle:44,ProcessName:"Adobe Premiere Pro"}])}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere kholo","guard-cross-app",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("guard-cross-app")[0]?.includes("Unsafe or ambiguous UI target"),"unsafe blocked");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
});
test("Batch 13 allows uniquely observed exact window but still requires owner Allow once",async()=>{
 const first={content:"windows",provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const second={content:"click",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026",name:"New"}}};
 const s=setup({first,second,stdoutFor:{ui_windows:JSON.stringify([
  {Name:"Adobe Premiere Pro 2026",ProcessId:200,NativeWindowHandle:44,ProcessName:"Adobe Premiere Pro"}])}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere kholo","guard-right-app",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"approval staged");
 assert.equal(s.staged[1].proposal.tool,"ui_click");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,false);
});

test("Batch 14 post-audit continuation exception does not start UI read recovery",async()=>{
 const s=setup({first:launch,second:{content:"continue",provider:"xkiro",model:"model/master",tool_proposal:null},
  continuationRenderError:true});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere kholo","audited-then-continuation-error",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("audited-then-continuation-error")[0]?.includes("Native action remained audit-verified"),"post-audit exception");
 const reply=s.transport.getReplies("audited-then-continuation-error")[0];
 assert.match(reply,/Master continuation errored/);
 assert.doesNotMatch(reply,/Native action outcome unknown/);
 assert.equal(s.calls.filter(c=>c.name==="action_audit_receipt").length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.staged.length,1);
});

test("Batch 16 blocks a second UI mutation after first click until new audited window read",async()=>{
 const windows={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const click={content:"click",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026",name:"New Project"}}};
 const secondClick={content:"click again",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026",name:"Save"}}};
 const s=setup({first:windows,second:click,following:[secondClick],
  stdoutFor:{ui_windows:JSON.stringify([{Name:"Adobe Premiere Pro 2026",ProcessId:111,NativeWindowHandle:222}])}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere me project bana ke save karo","stale-snapshot",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"first click approval");
 await until(()=>!s.allow.disabled,"first click clickable");
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("stale-snapshot")[0]?.includes("Unsafe or ambiguous UI target"),"stale target blocked");
 assert.equal(s.staged.length,2,"second click never prepared from stale snapshot");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2);
 assert.equal(s.chatInputs.length,3,"no automatic paid retry");
});

test("Batch 17 clearing chats cannot erase a pending native approval or its thread evidence",async()=>{
 const s=setup({first:launch});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere kholo","protected-clear",0);
 assert.equal(s.staged.length,1);
 assert.equal(s.approval.hidden,false);
 assert.equal(s.transport.canClearChats(),false);
 const before=s.transport.getReplies("protected-clear")[0];
 s.transport.clearAllChats();
 s.transport.clearChat("protected-clear");
 assert.equal(s.transport.getReplies("protected-clear")[0],before);
 assert.equal(s.approval.hidden,false);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 s.deny.listeners.get("click")();
 await until(()=>s.transport.canClearChats(),"native deny complete");
 s.transport.clearAllChats();
 assert.deepEqual(s.transport.getReplies("protected-clear"),[]);
});

test("Batch 18 Master prose without next tool reports unverified outcome even if it says done",async()=>{
 const first=launch;
 const second={content:"The project is fully saved!",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first,second});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere kholo aur new project banao","model-completion-only",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("model-completion-only")[0]?.includes("Outcome: UNVERIFIED"),
  "outcome evidence summary");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.chatInputs.length,2);
});
