import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("pending approvals and in-flight model calls block destructive chat clearing",()=>{
 assert.match(src,/clearAllChats:\(\)=>\{if\(pending\|\|sending\)return/);
 assert.match(src,/clearChat:\(threadId:string\)=>\{if\(sending\|\|pending\?\.threadId===threadId\)return/);
});
