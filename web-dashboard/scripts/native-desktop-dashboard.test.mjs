import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const web=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("visible installed app uses the SAME web dashboard and preserves existing agent-runtime",()=>{
 const cfg=JSON.parse(root("src-tauri/tauri.conf.json"));
 const visible=cfg.app.windows.find(w=>w.label==="main");
 const hidden=cfg.app.windows.find(w=>w.label==="agent-runtime");
 assert.equal(visible.url,"web-dashboard/index.html");
 assert.equal(hidden.url,"index.html");
 assert.equal(hidden.visible,false);
 assert.equal(cfg.build.frontendDist,"../dist");
 assert.deepEqual(JSON.parse(root("src-tauri/capabilities/default.json")).windows,["main","agent-runtime"]);
 const vite=root("vite.config.ts");
 assert.match(vite,/web-dashboard\/index\.html/);
 assert.match(vite,/web-dashboard\/src\/main\.ts/);
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
