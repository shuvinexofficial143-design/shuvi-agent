import test from "node:test";
import assert from "node:assert/strict";
import {taskReadPermissionKey as key} from "../src/task-read-permission-key.mjs";
import {createTaskPermissionScope as scope,grantTaskRead as grant,allowsTaskRead as allows} from "../src/task-permission-scope.mjs";

function proposal(tool, args) { return {tool,arguments:args}; }
function read(s,p) { return {taskId:s.taskId,key:key(p)??"",tool:p.tool,risk:"low"}; }

test("same typed arguments are canonical independent of object key order",()=>{
 const p=proposal("browser_dom_read",{pid:451,selector:"div",options:{limit:2,offset:0}});
 const q=proposal("browser_dom_read",{options:{offset:0,limit:2},selector:"div",pid:451});
 assert.equal(key(p),key(q));
 assert.match(key(p),/browser_dom_read\|pid:451\|args:/);
});

test("grant matches the entire request and not just path, process or window",()=>{
 const s=scope("task-one"), original=proposal("read_file",{path:"C:\\project\\a.txt",offset:0,max_bytes:64});
 assert.equal(grant(s,read(s,original),100),true);
 assert.equal(allows(s,read(s,original),101),true);
 for(const other of [
  proposal("read_file",{path:"C:\\project\\a.txt",offset:64,max_bytes:64}),
  proposal("read_file",{path:"C:\\project\\a.txt",offset:0,max_bytes:4096}),
  proposal("read_file",{path:"C:\\project\\a.txt",offset:0,max_bytes:64,extra:true}),
  proposal("read_file",{path:"C:\\project\\..\\project\\a.txt",offset:0,max_bytes:64}),
  proposal("read_file",{path:"C:\\project\\a.txt",offset:0}),
  proposal("list_directory",{path:"C:\\project\\a.txt",offset:0,max_bytes:64})
 ]) assert.equal(allows(s,read(s,other),101),false,JSON.stringify(other));
});

test("same PID and window cannot reuse a grant for other arguments",()=>{
 const s=scope("task-two");
 const p=proposal("browser_dom_read",{pid:555,url:"https://a.example",selector:"main"});
 grant(s,read(s,p),1);
 assert.equal(allows(s,read(s,proposal("browser_dom_read",{pid:555,url:"https://b.example",selector:"main"})),2),false);
 assert.equal(allows(s,read(s,proposal("browser_dom_read",{pid:556,url:"https://a.example",selector:"main"})),2),false);
 const w=proposal("ui_find",{window:"Premiere",query:"Export"});
 grant(s,read(s,w),2);
 assert.equal(allows(s,read(s,proposal("ui_find",{window:"Premiere",query:"Delete"})),3),false);
});

test("missing target does not create a blanket session grant",()=>{
 const empty=key(proposal("list_processes",{}));
 assert.equal(empty,"list_processes|args:{}");
 assert.ok(!empty.includes("|session"));
 assert.notEqual(empty,key(proposal("list_processes",{filter:"firefox"})));
});

test("invalid and oversized values cannot be granted or used",()=>{
 const s=scope("task-three");
 for(const args of [
  {pid:0},{pid:-12},{pid:1.5},{path:"x",limit:Infinity},
  {path:"x",filter:undefined},{path:"x".repeat(4100)},
  {nested:new Date()}, {nested:()=>{}}
 ]) {
  const p=proposal("read_file",args);
  assert.equal(key(p),null);
  assert.equal(grant(s,read(s,p),2),false);
 }
 const loop={};loop.loop=loop;
 assert.equal(key(proposal("read_file",loop)),null);
 assert.equal(key(proposal("ui_click",{window:"Premiere"}))?.startsWith("ui_click|"),true);
 assert.equal(grant(s,read(s,proposal("ui_click",{window:"Premiere"})),2),false);
});
