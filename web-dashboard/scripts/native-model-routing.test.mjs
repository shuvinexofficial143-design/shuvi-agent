import test from "node:test";import assert from "node:assert/strict";
import {classifyNativeIntent,chooseNativeRoute,safeNativeEndpoint,validModelId,NATIVE_MODEL_ROLES} from "../src/native-model-routing.mjs";
test("normal questions always stay on selected Chat model, even mentioning apps",()=>{
 assert.equal(classifyNativeIntent("hi Shuvi, how are you?"),"chat");
 assert.equal(classifyNativeIntent("Blender क्या है?"),"chat");
 assert.equal(classifyNativeIntent("Explain how to edit Premiere videos"),"chat");
});
test("intent labels are hints only; Master understands actual computer actions",()=>{
 assert.equal(classifyNativeIntent("Blender खोलो और एक घर बनाओ"),"blender");
 assert.equal(classifyNativeIntent("Open Adobe Premiere and edit my video"),"premiere");
 assert.equal(classifyNativeIntent("Make an animation in After Effects"),"after-effects");
 assert.equal(classifyNativeIntent("Open WhatsApp and send a message"),"whatsapp");
 assert.equal(classifyNativeIntent("@blender How is today?"),"blender");
 assert.equal(classifyNativeIntent("Open notepad"),"master");
 assert.equal(classifyNativeIntent("Open Blender and Premiere"),"master");
});
test("Master is mandatory for natural-language PC actions; explicit @worker stays opt-in",()=>{
 const cfg={provider:"xkiro",roles:{chat:"model/chat",master:"model/master",blender:"model/blender"}};
 assert.deepEqual(chooseNativeRoute("hi",cfg),{ok:true,role:"chat",provider:"xkiro",model:"model/chat",base_url:""});
 assert.deepEqual(chooseNativeRoute("Blender खोलो",cfg),{ok:true,role:"blender",provider:"xkiro",model:"model/master",base_url:""});
 assert.deepEqual(chooseNativeRoute("@blender sculpt this",cfg),{ok:true,role:"blender",provider:"xkiro",model:"model/blender",base_url:""});
 assert.deepEqual(chooseNativeRoute("Bhai whatsaap khol de",cfg),{ok:true,role:"master",provider:"xkiro",model:"model/master",base_url:""});
 assert.deepEqual(chooseNativeRoute("Bhai WhatsApp khol do",cfg),{ok:true,role:"whatsapp",provider:"xkiro",model:"model/master",base_url:""});
 const missing=chooseNativeRoute("Open Premiere",{...cfg,roles:{chat:"model/chat",premiere:"model/premiere"}});
 assert.equal(missing.ok,false);assert.match(missing.error,/Master AI/);
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
