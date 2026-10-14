import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("Batch 88 audited recovery approval redacts tool summary too",()=>{
 assert.match(s,/Read-only UI recovery · Allow once required: "\+\s*redactNativeError\(next\.summary\)/);
});
