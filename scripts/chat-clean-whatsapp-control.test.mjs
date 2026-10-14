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
test("WhatsApp is controlled as an installed Windows application, not a web integration",()=>{
 assert.doesNotMatch(html,/chatWhatsAppOpen/);
 assert.doesNotMatch(native,/prepare_whatsapp_open|__whatsapp_open__/);
 assert.doesNotMatch(rust,/https:\/\/web\.whatsapp\.com|fn prepare_whatsapp_open/);
 assert.match(rust,/whatsapp_desktop_open: \{\}/);
 assert.match(rust,/ToolAction::WhatsAppDesktopOpen/);
 assert.match(rust,/Get-StartApps/);
 assert.match(rust,/Start-Process -FilePath 'explorer.exe'/);
 assert.match(rust,/if !proposal\.arguments\.as_object\(\)\.is_some_and/);
 assert.match(rust,/RiskLevel::Medium/);
 assert.match(rust,/separately approved action/);
 assert.match(native,/audit_log/);
});
