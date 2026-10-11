import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync as fsReadFileSync} from "node:fs";
import {MODEL_ROLES,taskRole,validateModelRoute,loadModelRoutes,selectTaskRoute} from "../src/model-routing.mjs";
const providers=["xkiro","openrouter","openai","custom","ollama"];
const fallback={provider:"xkiro",model:"",base_url:""};
test("roles are distinct and supported",()=>assert.equal(new Set(MODEL_ROLES.map(x=>x[0])).size,MODEL_ROLES.length));
test("explicit task roles take precedence",()=>{
 assert.equal(taskRole("@premiere edit this scene"),"premiere");
 assert.equal(taskRole("@blender sculpt"),"blender");
 assert.equal(taskRole("Premiere and Blender together"),"master");
 assert.equal(taskRole("hello"),"master");
 assert.equal(taskRole("मेरी वेबसाइट में कोड बदलो"),"coding");
});
test("malformed or unsafe model routes fail closed",()=>{
 assert.equal(validateModelRoute("premiere",{provider:"missing",model:"x"},providers),null);
 assert.equal(validateModelRoute("premiere",{provider:"openrouter",model:""},providers),null);
 assert.equal(validateModelRoute("premiere",{provider:"openrouter",model:"secret\nleak"},providers),null);
 assert.equal(validateModelRoute("premiere",{provider:"custom",model:"test",base_url:"http://remote.host/api"},providers),null);
 assert.deepEqual(loadModelRoutes('{"__proto__":{"polluted":true}}',providers),{});
});
test("multiple roles can use different providers without exposing keys",()=>{
 const routes=loadModelRoutes(JSON.stringify({
  premiere:{provider:"openrouter",model:"openai/gpt-5.6-sol"},
  coding:{provider:"xkiro",model:"sol-6.1"},
  master:{provider:"openai",model:"gpt-5.6"}
 }),providers);
 assert.deepEqual(selectTaskRoute("Premiere edit",routes,fallback),{provider:"openrouter",model:"openai/gpt-5.6-sol",base_url:"",role:"premiere"});
 assert.equal(selectTaskRoute("write Python code",routes,fallback).provider,"xkiro");
 assert.equal(selectTaskRoute("hello",routes,fallback).role,"master");
 assert.equal(JSON.stringify(routes).includes("api_key"),false);
});
test("unconfigured route falls back honestly without inventing a model",()=>{
 const r=selectTaskRoute("make Blender",{},fallback);
 assert.deepEqual(r,{...fallback,role:"default"});
});


test("native preparation uses the SAME task-pinned provider/model as paid planning",()=>{
 const {readFileSync}=requireForTest();
 const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const planning=main.indexOf('const response = await invoke<ChatResponse>("chat",');
 const route=main.lastIndexOf("const route = taskModelRoute ??",planning);
 assert.ok(route>=0 && planning>route);
 assert.match(main,/async function stageProposal\(proposal: ToolProposal, route: TaskModelRoute\)/);
 assert.match(main,/await stageProposal\(response.tool_proposal, route\)/);
 const start=main.indexOf('pendingAction = await invoke<PendingAction>("prepare_tool"');
 const end=main.indexOf('pendingChatProposal = proposal',start);
 assert.ok(start>=0 && end>start);
 const block=main.slice(start,end);
 assert.match(block,/provider: route.provider/);
 assert.match(block,/model: route.model/);
 assert.match(block,/baseUrl: route.base_url \|\| null/);
 assert.doesNotMatch(block,/providerSelect.value|modelInput.value|baseUrlInput.value/);
});
function requireForTest(){return {readFileSync:fsReadFileSync};}
