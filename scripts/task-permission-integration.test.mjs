import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("task changes and checkpoint restoration rotate all read grants",()=>{
 assert.match(main,/beginTaskRoute\(content\);[\s\S]{0,100}rotatePermissionScope\(\)/);
 assert.match(main,/rotatePermissionScope\(\); \/\/ Restoring progress never restores permission grants/);
 assert.match(main,/remoteTask=\{message:m[\s\S]{0,360}rotatePermissionScope\(\)/);
});
test("low-risk auto-execution is allowed only through scoped TTL checks",()=>{
 assert.match(main,/allowsTaskRead\(activePermissionScope,activeReadGrant\(proposal,pendingAction\.risk\)\)/);
 assert.match(main,/grantTaskRead\(activePermissionScope,activeReadGrant\(proposal,pendingAction\.risk\)\)/);
 assert.doesNotMatch(main,/sessionAllowedScopes\.(?:add|has)/);
 assert.match(main,/key:taskReadPermissionKey\(proposal\) \?\? ""/);
 assert.match(main,/taskReadPermissionKey\(proposal\) !== null/);
 assert.doesNotMatch(main,/\|session/);
});
