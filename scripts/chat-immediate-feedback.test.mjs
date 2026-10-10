import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

// Execute the real TypeScript Chat controller with a minimal in-memory DOM,
// not merely a string match. No native IPC, network, filesystem or paid calls.
const entry=fileURLToPath(new URL("../web-dashboard/src/chat-workspace.ts",import.meta.url));
const bundle=await build({entryPoints:[entry],bundle:true,platform:"node",format:"esm",
  target:"node22",write:false});
const {mountChatWorkspace}=await import("data:text/javascript;base64,"+
  Buffer.from(bundle.outputFiles[0].text).toString("base64"));

function element(){
  const e={
    className:"",textContent:"",value:"",hidden:false,disabled:false,children:[],
    dataset:{},listeners:new Map(),style:{},scrollHeight:0,scrollTop:0,
    classList:{toggle(){},add(){},remove(){}},
    addEventListener(name,fn){this.listeners.set(name,fn);},
    setAttribute(){},removeAttribute(){},focus(){},
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=items;},
    requestSubmit(){},
    contains(){return false;}
  };
  return e;
}
function setup(remote){
  const nodes=new Map(),storage=new Map();
  globalThis.localStorage={
    getItem:k=>storage.get(k)??null,
    setItem:(k,v)=>storage.set(k,String(v)),
    removeItem:k=>storage.delete(k)
  };
  globalThis.window={localStorage:globalThis.localStorage};
  globalThis.document={
    getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},
    createElement(){return element();},
    querySelectorAll(){return [];}
  };
  const notice=[];
  const chat=mountChatWorkspace(msg=>notice.push(msg),remote);
  const get=id=>nodes.get(id);
  const visibleText=()=>{
    const walk=node=>typeof node==="string"?node:
      [node?.textContent??"",...(node?.children??[]).map(walk)].join(" ");
    return walk(get("chatMessages"));
  };
  const saved=()=>JSON.parse(storage.get("shuvi.web.chat-drafts.v1"));
  const send=(text)=>{
    const input=get("chatInput");
    input.value=text;
    input.listeners.get("input")();
    return get("chatForm").listeners.get("submit")({preventDefault(){}});
  };
  return {get,visibleText,saved,send,notice,chat};
}
function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

test("send clears composer immediately, shows awaiting AI, and persists exactly once after reply",async()=>{
  const d=deferred(),calls=[];
  const ui=setup({kind:"native",connected:()=>true,
    send:(text,thread,index)=>{calls.push({text,thread,index});return d.promise;},
    getReplies:()=>["This is the actual AI response."]});
  const pending=ui.send("Hello Shuvi");
  assert.equal(ui.get("chatInput").value,"");
  assert.equal(ui.get("chatInput").disabled,true);
  assert.match(ui.visibleText(),/Hello Shuvi/);
  assert.match(ui.visibleText(),/Waiting for your selected AI model/);
  assert.equal(ui.saved().threads[0].messages.length,0,"pending must not fake accepted message");
  assert.equal(ui.saved().threads[0].draft,"Hello Shuvi","draft must survive reload before ack");
  d.resolve({ok:true,reply:"This is the actual AI response."});
  await pending;
  assert.equal(calls.length,1,"no extra API call");
  assert.equal(ui.get("chatInput").disabled,false);
  assert.equal(ui.get("chatInput").value,"");
  assert.equal(ui.saved().threads[0].messages.length,1);
  assert.match(ui.visibleText(),/This is the actual AI response/);
  assert.doesNotMatch(ui.visibleText(),/Waiting for your selected AI model/);
});

test("provider error restores draft and does not persist or retry failed send",async()=>{
  const d=deferred(),calls=[];
  const ui=setup({kind:"native",connected:()=>true,
    send:(text)=>{calls.push(text);return d.promise;},getReplies:()=>[]});
  const pending=ui.send("My expensive question");
  assert.match(ui.visibleText(),/My expensive question/);
  d.resolve({ok:false,error:"Provider returned 503 Service Unavailable"});
  await pending;
  assert.equal(calls.length,1);
  assert.equal(ui.saved().threads[0].messages.length,0);
  assert.equal(ui.get("chatInput").value,"My expensive question");
  assert.match(ui.visibleText(),/not automatically retried/);
  assert.match(ui.get("chatProviderStatus").textContent,/HTTP 503/);
});