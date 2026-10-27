import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ui=read("src/remote-command-client.ts"),chat=read("src/chat-workspace.ts"),main=read("src/main.ts");
test("same Shuvi chat uses secure relay only after explicit authentication",()=>{
 assert.match(main,/mountRemoteCommandClient/);
 assert.match(main,/mountChatWorkspace\([\s\S]*nativeChat \?\? remoteChat \?\? undefined\)/);
 assert.match(chat,/remote\?\.connected\(\)/);
 assert.match(chat,/await remote\.send\(text,t\.id,t\.messages\.length\)/);
 assert.match(chat,/Draft kept/);
 assert.match(chat,/Windows agent offline · Not delivered/);
});
test("browser does not persist remote code or claim native execution",()=>{
 assert.match(ui,/let key=""/);
 assert.match(ui,/credentials:"omit"/);
 assert.match(ui,/cache:"no-store"/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|SHUVI_REMOTE_AGENT_KEY/);
 assert.match(ui,/Windows execution NOT yet confirmed/);
 assert.match(ui,/cloud/i);
});

test("BUG-021: client polls bounded authenticated status and cancels stale transport on disconnect",()=>{
 assert.match(ui,/VISIBLE_POLL_MS=4500, HIDDEN_POLL_MS=20000, MAX_BACKOFF_MS=30000/);
 assert.match(ui,/window\.setTimeout\(\(\)=>\{/);
 assert.match(ui,/document\.addEventListener\("visibilitychange"/);
 assert.match(ui,/connectionEpoch\+\+/);
 assert.match(ui,/for\(const controller of outstanding\)controller\.abort\(\)/);
 assert.match(ui,/if\(epoch!==connectionEpoch\|\|!key\)return false/);
 assert.match(ui,/Math\.min\(MAX_BACKOFF_MS/);
 assert.doesNotMatch(ui,/setInterval\(/);
});
test("BUG-024: mobile does not offer stop to an expired unacknowledged command",()=>{
 assert.match(ui,/t\.delivery==="expired_not_delivered"/);
 assert.match(ui,/Expired · no Windows agent admission confirmed/);
 assert.match(ui,/const active=!expiredUnadmitted&&/);
 assert.match(ui,/Number\.isSafeInteger\(t\.expiresAt\)&&t\.expiresAt<=Date\.now\(\)/);
});
