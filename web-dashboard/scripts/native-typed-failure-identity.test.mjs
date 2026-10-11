import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("failed typed native result must belong to exact approved action before recovery",()=>{
 assert.match(src,/if\(!verified && result\.success===false && result\.tool===current\.action\.kind\)/);
 assert.match(src,/contradictsFailureReceipt\(current\.action,receipts\)/);
});
