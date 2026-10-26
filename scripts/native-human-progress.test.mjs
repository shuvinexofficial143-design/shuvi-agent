import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {nativeReadProgress} from "../web-dashboard/src/native-human-progress.mjs";
const agent=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("all deterministic readback progress uses fixed Hindi instead of raw native output",()=>{
 for(const tool of ["ui_windows","ui_discover","ui_find","browser_page_state"]){
  const msg=nativeReadProgress({tool,arguments:{window:"Premiere",pid:1234,hwnd:3456}});
  assert.match(msg,/[अ-ह]/);
  assert.doesNotMatch(msg,/\bPID\b|\bHWND\b|RuntimeId|PowerShell|\{|"tool"|1234|3456/);
 }
 assert.match(agent,/plannedReadback\?nativeReadProgress\(plannedReadback\)/);
});
