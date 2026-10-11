import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("native tool proposal fingerprint is validated before Rust staging",()=>{
 const start=source.indexOf('const first=fingerprint(response.tool_proposal);');
 const end=source.indexOf('const proposed=await invoke<Pending>("prepare_tool"',start);
 assert.ok(start>0&&end>start);
 assert.match(source.slice(start,end),/if\(!first\)throw Error/);
});
test("native first and follow-up action IDs and tool types must match proposal",()=>{
 assert.match(source,/proposed\.kind!==response\.tool_proposal\.tool/);
 assert.match(source,/next\.kind!==response\.tool_proposal\.tool/);
 assert.match(source,/!proposed\.id\.trim\(\)/);
 assert.match(source,/!next\.id\.trim\(\)/);
});
