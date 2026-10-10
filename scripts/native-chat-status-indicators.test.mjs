import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const html=read("web-dashboard/index.html");
const ui=read("web-dashboard/src/chat-workspace.ts");
const styles=read("web-dashboard/src/multi-chat.css");
test("native Chat surfaces have explicit dynamic status targets instead of permanent offline labels",()=>{
 for(const id of ["sidebarRuntimeDot","sidebarRuntimeHelper","sidebarRuntimeConnect","chatRuntimeIntroduction","chatRuntimePill","chatRuntimeEyebrow","chatComposerStatus","chatProviderStatus","chatCreativeStatus","chatComputerStatus","chatRuntimeSecurityNote"]){
  assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,new RegExp('"'+id+'"'));
 }
 assert.match(ui,/nativeConnected \? "Send to Shuvi/);
 assert.match(ui,/chatRuntimePill/);
 assert.match(styles,/chat-offline-pill\.connected/);
});
test("provider 503 is distinct from healthy IPC and does not trigger automatic paid retries",()=>{
 assert.match(ui,/providerRuntimeStatus = providerHttp/);
 assert.match(ui,/HTTP " \+ providerHttp\[1\] \+ " · request failed"/);
 assert.match(ui,/if\(!result\.ok\)/);
 assert.match(ui,/Draft kept\./);
 assert.doesNotMatch(ui,/setTimeout\(.*remote\.send|while\(.*remote\.send/);
 assert.match(ui,/Not paired \/ unverified/);
 assert.match(ui,/Approval required/);
});
