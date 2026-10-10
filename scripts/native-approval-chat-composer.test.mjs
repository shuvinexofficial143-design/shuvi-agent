import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const source = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const ts = source("web-dashboard/src/native-agent.ts");
const css = source("web-dashboard/src/native-agent.css");
const html = source("web-dashboard/index.html");

test("native approval is mounted beside the current Chat composer, never only in a hidden card",()=>{
  assert.match(html, /id="chatForm"/);
  assert.match(ts,/composerParent\.insertBefore\(approval,chatForm\)/);
  assert.match(ts,/composerParent\.insertBefore\(actionFeedback,chatForm\)/);
  assert.match(ts,/approval\.scrollIntoView\?\.\(/);
  assert.match(css,/chat-panel>\.shuvi-native-approval:not\(\[hidden\]\)/);
  assert.match(css,/chat-panel>\.shuvi-native-approval\[hidden\]\{display:none!important\}/);
});
test("unrecognized model JSON never implies Windows action executed",()=>{
  assert.match(ts,/The AI wrote tool-like JSON, but it was not recognized/);
  assert.match(ts,/No Windows action was prepared or executed/);
  assert.match(ts,/showActionFeedback\("AI replied but Windows could not prepare/);
});
test("manual Allow once is still required before any native execute command",()=>{
  const src=ts.slice(ts.indexOf("async function decide("),ts.indexOf("approve.addEventListener("));
  assert.match(src,/if\(!allowed\)/);
  assert.match(src,/invoke<ActionResult>\("execute_action"/);
  assert.match(src,/audit_log/);
});
const entry=fileURLToPath(new URL("../web-dashboard/src/native-agent.ts",import.meta.url));
const {outputFiles}=await build({
 entryPoints:[entry],bundle:true,platform:"node",format:"esm",write:false,
 plugins:[{name:"settings-stub",setup(b){
  b.onResolve({filter:/^\.\/native-model-setup$/},()=>({path:"setup",namespace:"stub"}));
  b.onLoad({filter:/.*/,namespace:"stub"},()=>({
   contents:'export function mountNativeModelSetup(){return {current:()=>({provider:"xkiro",base_url:"",roles:{chat:"model/chat",whatsapp:"model/wa",master:"model/master"}})}}',
   loader:"js"
  }));
 }}]
});
const {mountNativeAgent}=await import("data:text/javascript;base64,"+
 Buffer.from(outputFiles[0].text).toString("base64"));
function element(){
 return {
  textContent:"",hidden:false,disabled:false,innerHTML:"",value:"",
  className:"",children:[],listeners:new Map(),attributes:{},parentElement:null,
  style:{},classList:{toggle(){return true;}},
  setAttribute(name,v){this.attributes[name]=v;},
  addEventListener(name,fn){this.listeners.set(name,fn);},
  append(...items){this.children.push(...items);},
  insertBefore(item,before){this.children.push(item);},
  scrollIntoView(){this.scrolled=true;},
  focus(){}
 };
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function setup(reply){
 const panelParent=element(),composerParent=element(),form=element();
 form.parentElement=composerParent;
 const chat=element(); chat.parentElement=panelParent;
 const nodes={chatWorkspaceLayout:chat,chatForm:form};
 const els=[];
 globalThis.document={
  getElementById(id){return nodes[id]??null;},
  createElement(){const e=element();els.push(e);return e;},
  querySelector(){return null;}
 };
 const commands=[];
 const invoke=async(name)=>{
  commands.push(name);
  switch(name){
   case "runtime_status":return {shuvi_memory_mb:12,managed_children_count:0};
   case "list_providers":return [{id:"xkiro",name:"xKiro"}];
   case "remote_agent_status":return {enabled:false};
   case "chat":return reply;
   case "prepare_tool":return {id:"pending-1",kind:"whatsapp_desktop_open",summary:"Open WhatsApp Desktop",risk:"medium",detail:"No messages sent"};
   default:throw Error("unexpected native call "+name);
  }
 };
 globalThis.window={__TAURI_INTERNALS__:{invoke}};
 const client=mountNativeAgent(()=>{});
 await new Promise(r=>setImmediate(r));
 return {client,commands,els,composerParent,panelParent};
}
test("valid WhatsApp proposal creates visible Allow once beside composer and never auto executes",async()=>{
 const s=await setup({content:'{"tool":"whatsapp_desktop_open","arguments":{}}',
   provider:"xkiro",model:"model/wa",tool_proposal:{tool:"whatsapp_desktop_open",arguments:{}}});
 const ans=await s.client.send("WhatsApp Desktop खोलो","chat-id",0);
 assert.equal(ans.ok,true);
 assert.equal(s.commands.filter(x=>x==="chat").length,1);
 assert.equal(s.commands.filter(x=>x==="prepare_tool").length,1);
 assert.equal(s.commands.includes("execute_action"),false);
 const approval=s.els.find(e=>e.attributes["aria-label"]==="Windows action needs your approval");
 assert.ok(approval);
 assert.equal(approval.hidden,false);
 assert.equal(s.composerParent.children.includes(approval),true);
 assert.equal(approval.scrolled,true);
 assert.ok(approval.children.some(e=>e.textContent==="Allow once"));
});
test("JSON-like text without parsed proposal visibly explains no action and does not stage",async()=>{
 const s=await setup({content:'{"tool":"whatsapp_desktop_open","arguments":{}}',
   provider:"xkiro",model:"model/wa",tool_proposal:null});
 await s.client.send("WhatsApp Desktop खोलो","chat-id",0);
 assert.equal(s.commands.includes("prepare_tool"),false);
 const feedback=s.els.find(e=>e.className==="shuvi-native-action-feedback");
 assert.equal(feedback.hidden,false);
 assert.match(feedback.textContent,/not recognized as a valid native action/);
});
