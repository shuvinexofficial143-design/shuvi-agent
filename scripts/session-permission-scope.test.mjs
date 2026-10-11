import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {taskReadPermissionKey} from "../src/task-read-permission-key.mjs";
import {createTaskPermissionScope,grantTaskRead,allowsTaskRead} from "../src/task-permission-scope.mjs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("read permission binds the exact path AND typed arguments, never workspace/prefix",()=>{
  const task=createTaskPermissionScope("verified-task");
  const original={tool:"read_file",arguments:{path:"C:\\work\\file.txt",max_bytes:64}};
  const candidate={tool:"read_file",arguments:{path:"C:\\work\\file.txt",max_bytes:128}};
  const alias={tool:"read_file",arguments:{path:"C:\\work\\..\\work\\file.txt",max_bytes:64}};
  const grant={taskId:task.taskId,key:taskReadPermissionKey(original),tool:original.tool,risk:"low"};
  assert.equal(grantTaskRead(task,grant,100),true);
  assert.equal(allowsTaskRead(task,grant,101),true);
  for(const changed of [candidate,alias]){
    const different={...grant,key:taskReadPermissionKey(changed)};
    assert.notEqual(different.key,grant.key);
    assert.equal(allowsTaskRead(task,different,101),false);
  }
  assert.doesNotMatch(grant.key,/\|workspace:|\|session|\|exact:/);
  assert.match(main,/key:taskReadPermissionKey\(proposal\) \?\? ""/);
  assert.doesNotMatch(main,/normalizedWorkspace/);
  assert.doesNotMatch(main,/normalizeScopePath/);
});

test("permission UI names an exact read request and never implies workspace-wide consent",()=>{
  const start=main.indexOf("function sessionPermissionLabel");
  const end=main.indexOf("function hiddenToolFailure",start);
  assert.ok(start>=0&&end>start);
  const block=main.slice(start,end);
  assert.match(block,/Allow this exact read request for current task \(5 min\)/);
  assert.doesNotMatch(block,/Allow in this workspace for session/);
  assert.match(main,/pendingAction\.risk === "low" && taskReadPermissionKey\(proposal\) !== null/);
});
