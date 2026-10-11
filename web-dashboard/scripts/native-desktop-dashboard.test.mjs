import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const web=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("visible installed app uses the SAME web dashboard and preserves existing agent-runtime",()=>{
 const cfg=JSON.parse(root("src-tauri/tauri.conf.json"));
 const visible=cfg.app.windows.find(w=>w.label==="main");
 const hidden=cfg.app.windows.find(w=>w.label==="agent-runtime");
 assert.equal(visible.url,"index.html");
 assert.equal(hidden.url,"agent-runtime/index.html");
 assert.equal(hidden.visible,false);
 assert.equal(cfg.build.frontendDist,"../dist");
 assert.deepEqual(JSON.parse(root("src-tauri/capabilities/default.json")).windows,["main","agent-runtime"]);
 const vite=root("vite.config.ts");
 assert.match(vite,/agent-runtime\/index\.html/);
 assert.match(root("index.html"),/src="\/web-dashboard\/src\/main\.ts"/);
});
test("native IPC only runs in the installed Tauri process; browser never receives execution endpoints",()=>{
 const adapter=web("src/native-agent.ts");
 const main=web("src/main.ts");
 assert.match(adapter,/__TAURI_INTERNALS__/);
 assert.match(adapter,/if\(!isNativeShuvi\(\)\)return null/);
 assert.match(adapter,/invoke<Runtime>\("runtime_status"\)/);
 assert.match(adapter,/invoke<NativeChatResponse>\("chat"/);
 assert.match(adapter,/invoke<Pending>\("prepare_tool"/);
 assert.match(adapter,/invoke<ActionResult>\("execute_action"/);
 assert.match(adapter,/invoke<void>\("deny_action"/);
 assert.match(adapter,/const matched=receipts\.find/);
 assert.match(adapter,/r\.action_id===current\.action\.id/);
 assert.doesNotMatch(adapter,/http:\/\/127\.0\.0\.1|fetch\(/);
 assert.match(main,/nativeChat \? null : mountRemoteCommandClient/);
});
test("normal web dashboard and remote mobile UI are preserved",()=>{
 const native=web("src/native-agent.ts");
 const cmd=web("src/remote-command-client.ts");
 const chat=web("src/chat-workspace.ts");
 assert.match(native,/native approval required/i);
 assert.match(cmd,/\/api\/remote-command/);
 assert.match(chat,/nativeReplies\[index\]/);
 assert.match(chat,/remote\.send\(text,t\.id,t\.messages\.length\)/);
});

test("Windows mobile pairing changes become visible to existing hidden agent coordinator",()=>{
 const source=root("src/main.ts");
 const adapter=web("src/native-agent.ts");
 assert.match(source,/await refreshRemoteAgent\(\);\s*if\(!remoteAgentEnabled\)return;\s*const inbox/);
 assert.match(adapter,/invoke<void>\("remote_agent_pair"/);
 assert.match(adapter,/invoke<void>\("remote_agent_disconnect"/);
 assert.match(adapter,/64-character Windows agent code/);
});

test("Windows Settings saves chosen models and secrets only in native keyring",()=>{
 const adapter=web("src/native-agent.ts");
 const ui=web("src/native-model-setup.ts");
 const lib=root("src-tauri/src/lib.rs");
 assert.match(adapter,/chooseNativeRoute\([^\n]*team\?\.current\(\)\)/);
 assert.match(adapter,/waitingForChoice\?"@master "\+text:text/);
 assert.match(adapter,/provider:route\.provider,model:route\.model/);
 assert.match(adapter,/base_url:route\.base_url\|\|null/);
 assert.match(ui,/settings\.insertBefore\(card,settings\.firstChild\)/);
 assert.match(ui,/invoke<void>\("save_api_key"/);
 assert.match(ui,/invoke<boolean>\("api_key_status"/);
 assert.match(ui,/invoke<CatalogItem\[]>\("list_xkiro_models"/);
 assert.match(ui,/window\.localStorage\.setItem\(STORAGE,JSON\.stringify\(config\)\)/);
 assert.doesNotMatch(ui,/localStorage\.setItem\([^\n]*(?:secret|key\.value)/);
 assert.match(lib,/async fn list_xkiro_models\(\)/);
 assert.match(lib,/https:\/\/api\.xkiro\.com\/v1\/models/);
 assert.match(lib,/fn api_key_status\(/);
 assert.match(lib,/list_xkiro_models,\s*api_key_status,\s*save_api_key,/);
});

test("background mobile agent respects visible dashboard model assignments without fallback",()=>{
 const native=root("src/main.ts");
 assert.match(native,/readLocalPreference\("shuvi\.native\.model\.team\.v1"\)/);
 assert.match(native,/chooseNativeRoute\(text,team\)/);
 assert.match(native,/provider:team\.provider,model:"",base_url:"",role:chosen\.role/);
});

test("source HTML makes premium Dashboard the installed default, with legacy entry hidden",()=>{
 const premium=root("index.html");
 const native=root("agent-runtime/index.html");
 const conf=JSON.parse(root("src-tauri/tauri.conf.json"));
 assert.match(premium,/<title>Shuvi Control Center<\/title>/);
 assert.match(premium,/id="navItems"/);
 assert.match(premium,/id="view-settings"/);
 assert.doesNotMatch(premium,/src="\/src\/entry\.ts"/);
 assert.match(native,/src="\/src\/entry\.ts"/);
 assert.equal(conf.version,"0.1.3");
});
