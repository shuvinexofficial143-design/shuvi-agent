import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

const entry=fileURLToPath(new URL("../web-dashboard/src/native-agent.ts",import.meta.url));
const bundle=await build({entryPoints:[entry],bundle:true,platform:"node",format:"esm",write:false,
 target:"node22",plugins:[{name:"model-stub",setup(builder){
  builder.onResolve({filter:/^\.\/native-model-setup$/},()=>({path:"stub",namespace:"fixture"}));
  builder.onLoad({filter:/.*/,namespace:"fixture"},()=>({loader:"js",contents:
   'export function mountNativeModelSetup(){return {current:()=>({provider:"xkiro",base_url:"",roles:{chat:"model",master:"model"}})}}'}));
 }}]});
const {mountNativeAgent}=await import("data:text/javascript;base64,"+
 Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function node(text=""){
 const listeners={};
 return {textContent:text,hidden:false,disabled:false,value:"",parentElement:{insertBefore(){}},
  classList:{toggle(){return true;}},setAttribute(){},scrollIntoView(){},append(){},
  insertBefore(){},addEventListener(name,fn){listeners[name]=fn;},click(){listeners.click?.();}};
}
function storage(){const data=new Map();return {getItem:k=>data.get(k)??null,
 setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
async function tick(){await new Promise(resolve=>setTimeout(resolve,0));}

test("two separate Windows goals reuse audited Edge via a NEW Allow once CDP probe, never launch Chrome",async()=>{
 const created=[];
 globalThis.document={createElement:()=>{const item=node();created.push(item);return item;},
  getElementById:id=>id==="chatWorkspaceLayout"?node():null};
 const store=storage();
 const seen=[];
 let saved=null;
 let nextAction=0;
 let modelCalls=0;
 const staged=new Map();
 const launch={tool:"browser_start",arguments:{browser:"edge",url:"https://www.youtube.com/"}};
 const page={tool:"browser_page_state",arguments:{pid:2456}};
 const invoke=async(command,args)=>{
  seen.push([command,args]);
  if(command==="runtime_status")return {shuvi_memory_mb:52,managed_children_count:0};
  if(command==="list_providers")return [{id:"xkiro",name:"xKiro",api_key_required:true}];
  if(command==="remote_agent_status")return {enabled:false};
  if(command==="save_native_recovery"){saved=args.record;return;}
  if(command==="load_native_recovery")return saved;
  if(command==="retire_verified_native_recovery"){saved=null;return;}
  if(command==="clear_native_recovery"){saved=null;return;}
  if(command==="chat"){
   modelCalls++;
   if(modelCalls===1)return {content:JSON.stringify(launch),provider:"xkiro",model:"model",tool_proposal:launch};
   if(modelCalls===2)return {content:JSON.stringify({tool:"browser_start",arguments:{browser:"chrome",url:"https://www.youtube.com/results?search_query=Arijit+Singh"}}),
    provider:"xkiro",model:"model",tool_proposal:{tool:"browser_start",arguments:{browser:"chrome",url:"https://www.youtube.com/results?search_query=Arijit+Singh"}}};
   if(modelCalls===3){
    const next={tool:"browser_navigate",arguments:{pid:2456,url:"https://www.youtube.com/results?search_query=Arijit+Singh"}};
    return {content:JSON.stringify(next),provider:"xkiro",model:"model",tool_proposal:next};
   }
   return {content:"Unable to confirm next step.",provider:"xkiro",model:"model",tool_proposal:null};
  }
  if(command==="prepare_tool"){
   const id=uuid(++nextAction);
   staged.set(id,args.proposal);
   return {id,kind:args.proposal.tool,summary:"read-only or browser action",detail:"owner approval required",risk:"low"};
  }
  if(command==="execute_action"){
   const proposal=staged.get(args.actionId);
   assert.ok(proposal);
   const output=proposal.tool==="browser_start"
    ?"Started Shuvi-managed edge with root PID 2456, local DevTools port 9222, and one bound page target."
    :JSON.stringify({origin:"https://www.youtube.com",pathname:"/",readyState:"complete",title:"YouTube"});
   return {success:true,tool:proposal.tool,stdout:output,stderr:"",exit_code:0};
  }
  if(command==="audit_log")return [...staged.entries()].map(([id,proposal])=>({
   action_id:id,tool:proposal.tool,event:"executed",success:true
  }));
  if(command==="remote_agent_disconnect")return;
  throw Error("Unexpected IPC "+command);
 };
 globalThis.window={__TAURI_INTERNALS__:{invoke},localStorage:store};
 const transport=mountNativeAgent(()=>{});
 await tick();
 assert.equal(transport.connected(),true);
 assert.equal((await transport.send("YouTube kholo","same-thread",0)).ok,true);
 const approve=created.find(x=>x.textContent==="Allow once");
 assert.ok(approve);
 approve.click();
 await tick();
 assert.equal(nextAction,2,"initial launch was followed by deterministic independent page readback");
 approve.click();
 await tick();
 assert.equal(modelCalls,1,"opening completion needs no extra AI charge");
 assert.match(transport.getReplies("same-thread")[0],/YouTube HOME PAGE VERIFIED/);
 assert.equal((await transport.send("YouTube par Arijit Singh ke gane search karo","same-thread",1)).ok,true);
 assert.equal(modelCalls,2);
 assert.deepEqual(staged.get(uuid(3)),page,"new command stages read-only original Edge PID, not Chrome launch");
 assert.equal([...staged.values()].filter(x=>x.tool==="browser_start").length,1);
 assert.equal(seen.filter(([name])=>name==="execute_action").length,2,
  "third readback is awaiting a fresh Allow once, not auto-executed");
 approve.click();
 await tick();
 assert.equal(modelCalls,3,"after fresh Rust audit, Master resumes same goal once");
 assert.deepEqual(staged.get(uuid(4)),{tool:"browser_navigate",arguments:{pid:2456,
  url:"https://www.youtube.com/results?search_query=Arijit+Singh"}},
 "actual next mutation is staged with the original Edge PID");
 assert.equal(seen.filter(([name])=>name==="execute_action").length,3,
  "continuation mutation still requires a separate fourth Allow once");
});
