import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("Batch 60 native action approval summaries, risks and details are credential-redacted",()=>{
 for(const key of ["next.summary","next.risk","next.detail","proposed.summary","proposed.risk","proposed.detail"])
  assert.ok(src.includes("redactNativeError("+key+")"),key);
 assert.ok(!src.includes("+next.summary+"));
 assert.ok(!src.includes("+proposed.detail;"));
});
