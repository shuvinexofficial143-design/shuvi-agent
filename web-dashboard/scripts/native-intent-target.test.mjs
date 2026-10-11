import test from "node:test";import assert from "node:assert/strict";
import {requestedAppScope,checkRequestedAppTarget as check} from "../src/native-intent-target.mjs";
test("user's single named app is scoped; multi-app workflows are not guessed",()=>{
 assert.equal(requestedAppScope("Premiere kholo"),"premiere");
 assert.equal(requestedAppScope("Blender खोलो"),"blender");
 assert.equal(requestedAppScope("Premiere और Photoshop खोलो"),null);
});
test("wrong named application cannot receive a UI click from another app's task",()=>{
 assert.equal(check("Premiere kholo",{tool:"ui_click",arguments:{window:"Adobe Photoshop 2026"}}).allowed,false);
 assert.equal(check("Premiere kholo",{tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026"}}).allowed,true);
 assert.equal(check("Premiere kholo",{tool:"ui_windows",arguments:{}}).allowed,true);
});

test("Batch 27 app-scoped read-only UI lookup does not wander into another app",()=>{
 assert.equal(check("Premiere kholo",{tool:"ui_find",arguments:{window:"Adobe Photoshop 2026"}}).allowed,false);
 assert.equal(check("Premiere kholo",{tool:"ui_discover",arguments:{window:"Adobe Premiere Pro 2026"}}).allowed,true);
 assert.equal(check("Premiere kholo",{tool:"ui_windows",arguments:{}}).allowed,true);
});

test("Batch 56 other Adobe apps are scoped without blocking explicit multi-app work",()=>{
 const pairs=[["Media Encoder","Adobe Photoshop"],["Adobe Animate","Adobe Illustrator"],
  ["Character Animator","Adobe Premiere"],["Substance 3D","Adobe Photoshop"],
  ["Frame.io","Adobe Premiere"]];
 for(const [requested,other] of pairs){
  assert.ok(requestedAppScope(requested));
  assert.equal(check("Open "+requested,{tool:"ui_click",arguments:{window:other}}).allowed,false,requested);
 }
 assert.equal(requestedAppScope("Open Adobe Animate and Media Encoder"),null);
});
