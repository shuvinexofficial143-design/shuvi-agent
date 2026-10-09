import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ui=read("src/remote-command-client.ts"),chat=read("src/chat-workspace.ts"),main=read("src/main.ts");
test("same Shuvi chat uses secure relay only after explicit authentication",()=>{
 assert.match(main,/mountRemoteCommandClient/);
 assert.match(main,/mountChatWorkspace\([\s\S]*remoteChat\)/);
 assert.match(chat,/remote\?\.connected\(\)/);
 assert.match(chat,/await remote\.send\(text,t\.id\)/);
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
