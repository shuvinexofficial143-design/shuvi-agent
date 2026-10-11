import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("Batch 59 typed failure and owner recovery diagnostics redact secrets",()=>{
 assert.match(src,/const failure=redactNativeError\(\[result\.stderr,result\.stdout\]/);
 assert.match(src,/verified native failure receipt: "\+redactNativeError\(message\)/);
});
