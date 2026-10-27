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

test("Roman Hindi and simple English imperative UI requests route to Master, not Chat",()=>{
 for(const command of ["Premiere me New Project banao","Premiere me New Project khojo",
  "Premiere ko dekho","Look for New Project in Premiere"])
  assert.equal(classifyNativeIntent(command),"premiere",command);
 assert.equal(classifyNativeIntent("Can you explain Premiere?"),"chat");
});

test("Batch 55 colloquial edit commands reach Master while simple questions remain Chat",()=>{
 const wants=["Premiere me clip import kar do","Blender object ko rename karo",
  "Photoshop layer ko select karo","Premiere me subtitles lagao",
  "Adobe Audition me audio trim kar do","Explorer me file copy karo"];
 for(const text of wants)assert.notEqual(classifyNativeIntent(text),"chat",text);
 assert.equal(classifyNativeIntent("What is a clip in Premiere?"),"chat");
 assert.equal(classifyNativeIntent("Explain how to trim a video"),"chat");
});

test("Batch 65 colloquial app spellings still reach the selected Master",()=>{
 for(const [request,role] of [
 ["Premire kholo aur project banao","premiere"],
 ["primiere open karo","master"],
 ["Open AfterEffects project","after-effects"],
 ["Open Photo Shop and select a layer","photoshop"]
 ]) assert.equal(classifyNativeIntent(request),role,request);
 assert.equal(classifyNativeIntent("Why does Photoshop exist?"),"chat");
});

test("Batch 82 capability questions stay Chat without losing direct Can you commands",()=>{
 for(const question of ["Can Premiere export 4K?","Does Blender render videos?","Will After Effects support VFX?"])
  assert.equal(classifyNativeIntent(question),"chat",question);
 assert.equal(classifyNativeIntent("Can you open Premiere?"),"premiere");
 assert.equal(classifyNativeIntent("Premiere export karo"),"premiere");
});

test("BUG-004: polite Devanagari Windows commands never disappear into ordinary Chat",()=>{
 for(const [prompt,expected] of [
  ["कृपया Premiere खोल दीजिए","premiere"],
  ["Photoshop में लोगो लगा दीजिए","photoshop"],
  ["Blender में मेरे लिए घर बना देना","blender"],
  ["प्रीमियर में वीडियो एक्सपोर्ट कर दीजिए","premiere"],
  ["Adobe Audition में आवाज सुनाकर दिखाइए","audition"],
  ["मेरी Windows फ़ाइल सेव कर दीजिए","master"],
  ["नोटपैड खोलकर दिखाइए","master"],
  ["क्या आप Blender में 3D घर बना सकते हो?","blender"],
  ["क्या तुम Premiere खोल सकते हो?","premiere"],
  ["क्या आप Photoshop में तस्वीर एडिट कर सकते हैं?","photoshop"],
  ["मेरे लिए एक नई फ़ाइल लिख दीजिए","master"],
  ["कृपया मेरा पेज दिखा दीजिए","master"],
 ])assert.equal(classifyNativeIntent(prompt),expected,prompt);
});
test("BUG-004: Roman Hindi polite phrasing chooses Master, not the cheaper Chat model",()=>{
 for(const p of ["Blender me 3D model bana dena","Premiere khol kar dikha do",
   "Photoshop me logo laga dena","Notepad me text likh kar do",
   "Explorer me file copy kar dena"])
  assert.notEqual(classifyNativeIntent(p),"chat",p);
});
test("BUG-004: capability and tutorial questions never authorize Windows action classification",()=>{
 for(const p of ["Premiere में वीडियो कैसे एक्सपोर्ट करें?",
   "Blender में 3D मॉडल बनाने का तरीका बताइए",
   "Photoshop का उपयोग कैसे करें?",
   "क्या Blender में 3D मॉडल बनाना संभव है?",
   "क्या Premiere के अंदर वीडियो एक्सपोर्ट होता है?",
   "Adobe Premiere export करने का तरीका समझाइए",
   "How to save file in Photoshop?",
   "क्या आप Photoshop के बारे में समझाइए"])
  assert.equal(classifyNativeIntent(p),"chat",p);
 const cfg={provider:"openrouter",roles:{chat:"chat-model",master:"master-model"}};
 assert.equal(chooseNativeRoute("Blender में घर बना दीजिए",cfg).model,"master-model");
 assert.equal(chooseNativeRoute("Blender में घर कैसे बनाते हैं?",cfg).model,"chat-model");
});
