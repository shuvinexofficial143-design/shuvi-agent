import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

/** Validate the actual built HTML, not just Tauri JSON. */
const read=path=>{assert.ok(existsSync(path),"Missing bundled Shuvi asset: "+path);return readFileSync(path,"utf8");};
const conf=JSON.parse(read("src-tauri/tauri.conf.json"));
const main=conf.app.windows.find(w=>w.label==="main");
const background=conf.app.windows.find(w=>w.label==="agent-runtime");
assert.equal(main?.url,"index.html","Visible Shuvi must open the Control Center as default page");
assert.equal(background?.url,"agent-runtime/index.html","Background coordinator must stay separate");
assert.equal(background.visible,false,"Legacy UI must remain invisible");
assert.equal(conf.version,"0.1.3","Do not distribute an installer with indistinguishable old version");
const root=read("dist/index.html");
const hidden=read("dist/agent-runtime/index.html");
assert.match(root,/<title>Shuvi Control Center<\/title>/);
assert.match(root,/id="navItems"/);
assert.match(root,/id="view-settings"/);
assert.match(root,/id="chatWorkspaceLayout"/);
const rootChatControls=[
  "chatContextToggle","chatDeleteAll","chatDeleteAllDialog",
  "chatDeleteAllConfirm","chatDeleteAllExecute","sidebarRuntimeDot",
  "sidebarRuntimeHelper","sidebarRuntimeConnect","chatRuntimePill",
  "chatRuntimeEyebrow","chatComposerStatus","chatProviderStatus",
  "chatCreativeStatus","chatComputerStatus","chatRuntimeSecurityNote",
  "chatNewTop","chatSendDraft"
];
for (const id of rootChatControls) {
  assert.ok(root.includes('id="'+id+'"'),"Installed Shuvi UI is missing live Chat control: "+id);
}
assert.doesNotMatch(root,/chatWhatsAppOpen|web\.whatsapp\.com/,"Do not reintroduce the WhatsApp Web launcher");
assert.doesNotMatch(root,/\/src\/entry\.ts/);
assert.match(hidden,/<title>Shuvi<\/title>/);
assert.doesNotMatch(hidden,/id="navItems"/);
assert.match(root,/\/assets\//);
assert.match(hidden,/\/assets\//);
console.log("PASS: installed root UI is Shuvi Premium Control Center; legacy native coordinator bundled only in hidden window");
