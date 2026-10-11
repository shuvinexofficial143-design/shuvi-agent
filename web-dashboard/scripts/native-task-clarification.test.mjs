import test from "node:test";import assert from "node:assert/strict";
import {taskClarificationKind,extendTaskClarification} from "../src/native-task-clarification.mjs";
test("explicit app, save folder and project name questions are recognized",()=>{
 assert.equal(taskClarificationKind("कौन-सा Adobe ऐप खोलूँ?","Premiere Pro"),"application");
 assert.equal(taskClarificationKind("Where should I save the project?","D:\\Projects"),"destination");
 assert.equal(taskClarificationKind("What project name should I use?","Shuvi AI Test 01"),"name");
 assert.equal(taskClarificationKind("किस फोल्डर में सेव करना है?","D:\\Projects"),"destination");
});
test("new command, cancellation, unasked answer and oversized answer must not inherit goal",()=>{
 assert.equal(taskClarificationKind("Which app should I open?","cancel"),null);
 assert.equal(taskClarificationKind("Which app should I open?","Photoshop खोलो"),null);
 assert.equal(taskClarificationKind("How are you?","Premiere Pro"),null);
 assert.equal(taskClarificationKind("What project name?","A".repeat(301)),null);
});
test("successive answers preserve the original named task, within bounded model context",()=>{
 const root="Adobe खोलकर Shuvi AI Test 01 नाम का प्रोजेक्ट बनाओ";
 const a=extendTaskClarification(root,"Premiere Pro","application");
 const b=extendTaskClarification(a,"D:\\Projects","destination");
 const c=extendTaskClarification(b,"Shuvi AI Test 01","name");
 assert.match(c,/Adobe खोलकर Shuvi AI Test 01/);
 assert.match(c,/Premiere Pro/);
 assert.match(c,/D:\\Projects/);
 assert.match(c,/name clarification/);
 assert.ok(extendTaskClarification("a".repeat(20000),"b".repeat(400),"name").length<=2500);
 assert.equal(extendTaskClarification(root,"unrelated",null),"unrelated");
});

test("Batch 11 only recognized clarification requests retain original Windows scope",async()=>{
 const {isTaskClarificationQuestion,nextClarificationRoot}=await import("../src/native-task-clarification.mjs");
 assert.equal(isTaskClarificationQuestion("कौन-सा Adobe ऐप खोलूँ?"),true);
 assert.equal(isTaskClarificationQuestion("Where should I save the project?"),true);
 assert.equal(isTaskClarificationQuestion("What project name should I use?"),true);
 assert.equal(isTaskClarificationQuestion("Project created successfully!"),false);
 assert.equal(nextClarificationRoot("Make project","Where should I save the project?",false,"master"),"Make project");
 assert.equal(nextClarificationRoot("Make project","Done!",false,"master"),null);
 assert.equal(nextClarificationRoot("Make project","Where should I save the project?",true,"master"),null);
 assert.equal(nextClarificationRoot("Make project","Where should I save the project?",false,"chat"),null);
});

test("Batch 34 imperative new command after a clarification is NOT inherited",()=>{
 assert.equal(taskClarificationKind("Where should I save the project?","Delete all old projects"),null);
 assert.equal(taskClarificationKind("Which app should I open?","Open Photoshop now"),null);
 assert.equal(taskClarificationKind("What project name should I use?","Reset the editor"),null);
 assert.equal(taskClarificationKind("Which app should I open?","Photoshop"),"application");
});
