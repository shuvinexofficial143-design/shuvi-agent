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
function setup({first=detection,second=launch,following=[],auditOk=true}={}){
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
  if(name==="chat"){chatInputs.push(params.input);return replies.shift()??{content:"Done",tool_proposal:null}}
  if(name==="prepare_tool"){
   const id="action-"+(staged.length+1);
   staged.push({id,proposal:params.proposal});
   return {id,kind:params.proposal.tool,summary:"Run "+params.proposal.tool,detail:"Approval needed",risk:"medium"};
  }
  if(name==="execute_action"){
   const action=staged.find(s=>s.id===params.actionId);
   if(!action)throw Error("unexpected action ID");
   return {success:true,tool:action.proposal.tool,stdout:action.proposal.tool==="premiere_detect"?detectedPath:"Launch requested",stderr:"",exit_code:0};
  }
  if(name==="audit_log")return auditOk?staged.map(s=>({event:"executed",action_id:s.id,tool:s.proposal.tool,success:true})):[];
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
