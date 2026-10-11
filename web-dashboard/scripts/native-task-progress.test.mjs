import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createTask,stageTask,executeTask,verifyTask,pauseTask,taskSummary,taskContext} from "../src/native-task-progress.mjs";
test("staging awaits approval and never increases success count",()=>{
 const s=stageTask(createTask(),"action1","premiere_launch",1);
 assert.equal(s.verified,0);assert.equal(s.phase,"awaiting_approval");
 assert.match(taskSummary(s),/awaiting Allow once/);
 assert.match(taskSummary(s),/Overall task unverified/);
});
test("only exact action and tool with confirmed Rust audit counts once",()=>{
 const s=stageTask(createTask(),"action1","premiere_launch",1);
 const run=executeTask(s,"action1");
 assert.strictEqual(executeTask(s,"other"),s);
 assert.strictEqual(verifyTask(s,"action1","premiere_launch",true),s);
 assert.strictEqual(verifyTask(run,"other","premiere_launch",true),run);
 assert.strictEqual(verifyTask(run,"action1","ui_windows",true),run);
 assert.strictEqual(verifyTask(run,"action1","premiere_launch",false),run);
 const done=verifyTask(run,"action1","premiere_launch",true);
 assert.equal(done.verified,1);assert.equal(done.pending,null);
 assert.strictEqual(verifyTask(done,"action1","premiere_launch",true),done);
 assert.match(taskContext(done),/Verified tools: premiere_launch/);
});
test("denial, unknown outcome and next tool never count as success",()=>{
 let s=stageTask(createTask(),"a1","ui_windows",1);
 s=verifyTask(executeTask(s,"a1"),"a1","ui_windows",true);
 const next=stageTask(s,"a2","ui_discover",2);
 assert.equal(next.verified,1);
 assert.match(taskSummary(next),/Step 2 ui_discover awaiting Allow once/);
 assert.match(taskSummary(pauseTask(next,"denied")),/Paused \(denied\)/);
 assert.equal(pauseTask(next,"unknown_outcome").verified,1);
});
test("long tasks keep total count while bounding history and rejecting malformed IDs",()=>{
 let s=createTask();
 assert.strictEqual(stageTask(s,"","ui_windows",1),s);
 assert.strictEqual(stageTask(s,"ok","oops;tool",1),s);
 for(let i=1;i<=30;i++){const id="a"+i;s=verifyTask(executeTask(stageTask(s,id,"ui_windows",i),id),id,"ui_windows",true);}
 assert.equal(s.verified,30);assert.equal(s.tools.length,8);
 assert.ok(taskContext(s).length<400);
});
test("native feedback obtains count only from successful action and matching audit",()=>{
 const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
 assert.match(src,/const verified=result\.success && Boolean\(matched\)/);
 assert.match(src,/if\(verified\)updateTask\(current\.threadId,verifyTask/);
 assert.match(src,/taskContext\(getTask\(task\.threadId\)\)/);
 assert.match(src,/aria-label","Native task progress"/);
 assert.match(src,/invoke<ActionResult>\("execute_action"/);
});
