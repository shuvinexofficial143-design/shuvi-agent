import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const r=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const html=r("web-dashboard/index.html"),chat=r("web-dashboard/src/chat-workspace.ts");
const native=r("web-dashboard/src/native-agent.ts");
const css=r("web-dashboard/src/multi-chat.css"),ncss=r("web-dashboard/src/native-agent.css");
const rust=r("src-tauri/src/lib.rs");
test("Chat layout is chat-first and optional runtime context is hidden",()=>{
 assert.match(css,/chat-workspace-layout>\.chat-context-panel\{display:none\}/);
 assert.match(html,/id="chatContextToggle"/);
 assert.match(chat,/let contextVisible = false/);
 assert.match(chat,/layout\.classList\.toggle\("show-context", contextVisible && !split\)/);
 assert.match(ncss,/shuvi-native-approval:not\(\[hidden\]\)/);
});
test("Delete all requires typed confirmation and clears local threads plus native history only",()=>{
 for(const id of ["chatDeleteAll","chatDeleteAllDialog","chatDeleteAllConfirm","chatDeleteAllExecute"])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(chat,/deleteAllConfirm\.value!=="DELETE"/);
 assert.match(chat,/canClearChats/);
 assert.match(chat,/if\(!saveChatLibrary\(next\)\)/);
 assert.match(chat,/remote\?\.clearAllChats\?\.\(\)/);
 assert.match(native,/histories\.clear\(\);replies\.clear\(\)/);
 assert.match(chat,/remote\?\.clearChat\?\.\(id\)/);
});
test("WhatsApp uses a fixed browser target, explicit owner approval, and audit",()=>{
 assert.match(html,/id="chatWhatsAppOpen"/);
 assert.match(native,/invoke<Pending>\("prepare_whatsapp_open"\)/);
 assert.match(native,/No WhatsApp message is sent automatically/);
 assert.match(native,/audit_log/);
 assert.match(rust,/fn prepare_whatsapp_open/);
 assert.match(rust,/"browser": "edge", "url": "https:\/\/web\.whatsapp\.com\/"/);
 assert.match(rust,/stage_tool\(proposal, None, state\.inner\(\)\)/);
 assert.match(rust,/prepare_whatsapp_open,\s*prepare_powershell/);
});
