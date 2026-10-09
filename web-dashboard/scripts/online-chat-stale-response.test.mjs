import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const chat=readFileSync(new URL("../src/online-chat.ts",import.meta.url),"utf8");
test("A14 a new online conversation aborts old requests and advances revision",()=>{
 const newChat=chat.slice(chat.indexOf('newButton.addEventListener("click"'),chat.indexOf('input.addEventListener("keydown"'));
 assert.match(chat,/let conversationRevision=0/);
 assert.match(chat,/let activeRequest:AbortController\|null=null/);
 assert.match(newChat,/conversationRevision\+\+/);
 assert.match(newChat,/activeRequest\?\.abort\(\)/);
 assert.match(newChat,/messages=\[\]/);
 assert.match(newChat,/prior request outcome unknown/);
});
test("A14 stale async responses cannot mutate the replacement conversation",()=>{
 const request=chat.slice(chat.indexOf('form.addEventListener("submit"'),chat.indexOf('void fetch("/api/online-status"'));
 assert.match(request,/const revision=conversationRevision/);
 assert.match(request,/const controller=new AbortController\(\)/);
 assert.match(request,/signal:controller\.signal/);
 assert.match(request,/window\.setTimeout\(\(\)=>controller\.abort\(\),34000\)/);
 assert.match(request,/if\(revision!==conversationRevision\)return/);
 assert.ok(request.indexOf("if(revision!==conversationRevision)return;")<request.indexOf('messages=[...messages,{role:"assistant"'));
 assert.match(request,/window\.clearTimeout\(timeoutId\)/);
 assert.match(request,/if\(revision===conversationRevision\)/);
 assert.doesNotMatch(request,/retry\(/);
});
