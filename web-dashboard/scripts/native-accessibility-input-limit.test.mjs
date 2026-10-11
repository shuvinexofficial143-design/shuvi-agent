import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("Batch 42 bounds untrusted accessibility payload before JSON parse and paid-model context",()=>{
 assert.match(src,/function compactObservedUi\(result:ActionResult\)/);
 assert.match(src,/if\(typeof result\.stdout!=="string"\|\|result\.stdout\.length>250000\)return null/);
 assert.match(src,/const budget=8800/);
});
