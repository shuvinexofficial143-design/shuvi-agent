import test from "node:test";import assert from "node:assert/strict";
import {taskOutcomeSummary} from "../src/native-task-outcome.mjs";
test("model saying task done cannot turn a launch into completion",()=>{
 assert.match(taskOutcomeSummary("Premiere kholo aur new project banao"),/Outcome: UNVERIFIED/);
 const live={app:"premiere",title:"Adobe Premiere Pro 2026",pid:9,hwnd:4};
 const partial=taskOutcomeSummary("Premiere kholo aur new project banao edit timeline export",live);
 assert.match(partial,/Outcome: PARTIALLY OBSERVED/);
 assert.match(partial,/project/);assert.match(partial,/edit/);assert.match(partial,/export/);
 assert.match(partial,/No overall task completion claim/);
});
test("opening-only status reports only the audited window observed",()=>{
 assert.match(taskOutcomeSummary("Premiere kholo",{app:"premiere",title:"Premiere",pid:9,hwnd:4}),/Outcome: WINDOW OBSERVED/);
 assert.match(taskOutcomeSummary("Premiere kholo",{app:"premiere",title:"Premiere",pid:9,hwnd:4}),/No other application, file or project effects were verified/);
});
