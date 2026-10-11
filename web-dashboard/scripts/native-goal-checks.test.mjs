import test from "node:test";import assert from "node:assert/strict";
import {taskGoalChecks,taskGoalContext,taskGoalLabel} from "../src/native-goal-checks.mjs";
test("new project cannot be marked done by app launch",()=>{
 const x=taskGoalChecks("Premiere kholo aur Shuvi AI Test naam ka new project banao");
 assert.deepEqual(x.map(v=>v.id),["window","project"]);
 assert.match(taskGoalContext("Premiere new project banao"),/approved save location/);
 assert.match(taskGoalLabel("Premiere new project banao"),/window, project/);
});
test("import, timeline editing and export each need independent observation",()=>{
 const x=taskGoalChecks("Blender open import media edit timeline and export");
 assert.deepEqual(x.map(v=>v.id),["window","media","edit","export"]);
 assert.match(taskGoalContext("Premiere export"),/completed export artifact/);
 assert.match(taskGoalContext("Premiere export"),/UNVERIFIED/);
});
test("bounded guidance does not echo original private request",()=>{
 const v=taskGoalContext(("open SECRET_SAMPLE_VALUE").repeat(2000));
 assert.ok(v.length<1600);assert.ok(!v.includes("SECRET_SAMPLE_VALUE"));
});

test("Batch 61 captions, B-roll, grading and final export remain unverified goals",()=>{
 const ids=taskGoalChecks("Premiere me subtitles, transitions, color grading aur final video export karo").map(x=>x.id);
 assert.deepEqual(ids,["window","edit","export"]);
 assert.deepEqual(taskGoalChecks("Add captions and b-roll").map(x=>x.id),["window","edit"]);
 assert.deepEqual(taskGoalChecks("Import audio").map(x=>x.id),["window","media"]);
});

test("Batch 67 saving an existing project needs independently verified on-disk outcome",()=>{
 assert.deepEqual(taskGoalChecks("Premiere project save karo").map(x=>x.id),["window","save"]);
 assert.deepEqual(taskGoalChecks("Blender save as").map(x=>x.id),["window","save"]);
 assert.deepEqual(taskGoalChecks("Premiere new project banao").map(x=>x.id),["window","project"]);
 assert.match(taskGoalContext("Blender save as"),/approved destination/);
});

test("Batch 69 audio cleanup is an independently unverified finishing criterion",()=>{
 assert.deepEqual(taskGoalChecks("Audition noise reduction and audio mixing").map(x=>x.id),["window","audio"]);
 assert.deepEqual(taskGoalChecks("Premiere edit with voice-over and export").map(x=>x.id),["window","edit","audio","export"]);
 assert.deepEqual(taskGoalChecks("Import audio").map(x=>x.id),["window","media"]);
 assert.match(taskGoalContext("noise reduction"),/audibly present/);
});
