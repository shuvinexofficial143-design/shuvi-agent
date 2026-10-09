import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const src=(path)=>readFileSync(new URL("../src/"+path,import.meta.url),"utf8");

test("Primary Shuvi conversation workspace is simply Chat",()=>{
  const nav=src("dashboard-data.ts"),main=src("main.ts");
  assert.match(nav,/id: "chat", label: "Chat", hint: "Conversations"/);
  assert.doesNotMatch(nav,/label: "Multi-Chat"/);
  assert.match(main,/chat: \{ eyebrow: "AI COMMAND CENTER", title: "Chat" \}/);
  assert.match(main,/mountOnlineChat\(\)/);
  assert.match(main,/mountChatWorkspace\(/);
});

test("Multi-chat remains a capability, not the main page label",()=>{
  const main=src("main.ts");
  const online=src("online-chat.ts");
  assert.match(main,/\.\/multi-chat\.css/);
  assert.match(online,/Local Drafts/);
  assert.match(online,/Online AI Chat/);
});
