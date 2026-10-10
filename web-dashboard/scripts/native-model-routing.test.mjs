import test from "node:test";import assert from "node:assert/strict";
import {classifyNativeIntent,chooseNativeRoute,safeNativeEndpoint,validModelId,NATIVE_MODEL_ROLES} from "../src/native-model-routing.mjs";
test("normal questions always stay on selected Chat model, even mentioning apps",()=>{
 assert.equal(classifyNativeIntent("hi Shuvi, how are you?"),"chat");
 assert.equal(classifyNativeIntent("Blender क्या है?"),"chat");
 assert.equal(classifyNativeIntent("Explain how to edit Premiere videos"),"chat");
});
test("actual computer tasks route to user's exact selected worker",()=>{
 assert.equal(classifyNativeIntent("Blender खोलो और एक घर बनाओ"),"blender");
 assert.equal(classifyNativeIntent("Open Adobe Premiere and edit my video"),"premiere");
 assert.equal(classifyNativeIntent("Make an animation in After Effects"),"after-effects");
 assert.equal(classifyNativeIntent("Open WhatsApp and send a message"),"whatsapp");
 assert.equal(classifyNativeIntent("@blender How is today?"),"blender");
 assert.equal(classifyNativeIntent("Open notepad"),"master");
 assert.equal(classifyNativeIntent("Open Blender and Premiere"),"master");
});
test("unconfigured task rejects request without using fallback or paid provider",()=>{
 const cfg={provider:"xkiro",roles:{chat:"openai/gpt-5.6-sol",blender:"z-ai/glm-5.3"}};
 assert.deepEqual(chooseNativeRoute("hi",cfg),{ok:true,role:"chat",provider:"xkiro",model:"openai/gpt-5.6-sol",base_url:""});
 assert.deepEqual(chooseNativeRoute("Blender खोलो",cfg),{ok:true,role:"blender",provider:"xkiro",model:"z-ai/glm-5.3",base_url:""});
 const missing=chooseNativeRoute("Open Premiere",cfg);
 assert.equal(missing.ok,false);assert.equal(missing.role,"premiere");
 assert.equal(validModelId("api\nkey"),false);
});
test("native custom URL validation avoids remote credential leaks and loopback escape",()=>{
 assert.equal(safeNativeEndpoint("custom","https://example.org/v1"),"https://example.org/v1/chat/completions");
 assert.equal(safeNativeEndpoint("custom","http://example.org/v1"),"");
 assert.equal(safeNativeEndpoint("custom","https://user:key@example.org/v1"),"");
 assert.equal(safeNativeEndpoint("ollama","http://192.168.1.6:11434/v1"),"");
 assert.equal(safeNativeEndpoint("ollama",""),"http://127.0.0.1:11434/v1/chat/completions");
 assert.ok(NATIVE_MODEL_ROLES.some(x=>x[0]==="chat"));
 assert.ok(NATIVE_MODEL_ROLES.some(x=>x[0]==="after-effects"));
});
