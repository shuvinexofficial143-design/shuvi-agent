import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const root=read("index.html");
const canonical=read("web-dashboard/index.html");
const rootScript='src="/web-dashboard/src/main.ts"';
const webScript='src="/src/main.ts"';
test("packaged Shuvi root UI is structurally identical to canonical Chat dashboard",()=>{
 assert.ok(root.includes(rootScript));
 assert.ok(canonical.includes(webScript));
 assert.equal(root.replace(rootScript,webScript),canonical,
  "Do not update only web-dashboard/index.html. Packaged Tauri window loads root index.html.");
});
test("installed Chat must contain all live controls used by imported Chat workspace",()=>{
 const required=[
  "chatContextToggle","chatDeleteAll","chatDeleteAllDialog",
  "chatDeleteAllConfirm","chatDeleteAllExecute","sidebarRuntimeDot",
  "sidebarRuntimeHelper","sidebarRuntimeConnect","chatRuntimePill",
  "chatRuntimeEyebrow","chatComposerStatus","chatProviderStatus",
  "chatCreativeStatus","chatComputerStatus","chatRuntimeSecurityNote",
  "chatNewTop","chatSendDraft","chatWorkspaceLayout"
 ];
 for(const id of required)assert.ok(root.includes('id="'+id+'"'),"Missing installed native control: "+id);
 assert.doesNotMatch(root,/chatWhatsAppOpen/);
});
test("installer verification targets compiled dist/index.html, not preview-only HTML",()=>{
 const verifier=read("scripts/verify-packaged-dashboard.mjs");
 assert.match(verifier,/read\("dist\/index\.html"\)/);
 assert.match(verifier,/rootChatControls/);
 assert.match(verifier,/chatDeleteAllConfirm/);
 assert.match(verifier,/sidebarRuntimeDot/);
});
