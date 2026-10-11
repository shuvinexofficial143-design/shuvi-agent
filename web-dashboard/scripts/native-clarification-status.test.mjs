import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("Batch 63 clarification questions are surfaced as waiting, not falsely complete",()=>{
 assert.match(source,/followupRoot\?"awaiting_clarification":"no_next_tool"/);
 assert.match(source,/nextRoot\?"awaiting_clarification":"no_tool"/);
 assert.match(source,/Master is waiting for your app\/name\/folder clarification/);
});
