import test from "node:test";import assert from "node:assert/strict";
import {createTaskPermissionScope as create,grantTaskRead as grant,allowsTaskRead as allows,revokeTaskScope as revoke,TASK_GRANT_TTL_MS as TTL} from "../src/task-permission-scope.mjs";
const read=(s,key="read_file|exact:c:\\project\\a.txt",tool="read_file",risk="low")=>({taskId:s.taskId,key,tool,risk});
test("a user-granted read is bounded to five minutes",()=>{
 const a=create("task-a"),g=read(a);
 assert.equal(allows(a,g,100),false);assert.equal(grant(a,g,100),true);
 assert.equal(allows(a,g,101),true);assert.equal(allows(a,g,100+TTL),false);
});
test("grant cannot cross task, native tool, target or risk",()=>{
 const a=create("task-a"),b=create("task-b");grant(a,read(a),1);
 assert.equal(allows(b,read(a),2),false);
 assert.equal(allows(a,{...read(a),taskId:b.taskId},2),false);
 assert.equal(allows(a,read(a,"read_file|exact:c:\\else.txt"),2),false);
 assert.equal(grant(a,read(a,"ui_click|window:premiere","ui_click"),2),false);
 assert.equal(grant(a,read(a,"read_file|exact:c:\\project\\a.txt","read_file","high"),2),false);
});
test("stop and resume reject previous approval grants",()=>{
 const a=create("task-a"),g=read(a);grant(a,g,1);revoke(a);
 assert.equal(allows(a,g,2),false);assert.equal(grant(a,g,2),false);
 assert.equal(allows(create("task-b"),g,2),false);
});
