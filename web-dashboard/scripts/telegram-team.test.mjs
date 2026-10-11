import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const source=name=>readFileSync(new URL("../src/"+name,import.meta.url),"utf8");
const readApi=name=>readFileSync(new URL("../api/"+name,import.meta.url),"utf8");

test("Telegram surfaces, webhook routes and settings are removed from Vercel app",()=>{
  const main=source("main.ts"),status=readApi("online-status.js");
  assert.doesNotMatch(main,/mountTelegram|telegram-web-setup|cloud-telegram-setup|telegram-team\.css/i);
  assert.doesNotMatch(status,/telegramConfigured|telegramReady|telegramConnectionTestOnly/);
  for(const path of [
    "../src/telegram-web-setup.ts",
    "../src/cloud-telegram-setup.ts",
    "../src/telegram-team.css",
    "../api/telegram.js",
    "../api/telegram-setup.js",
    "../api/telegram-discover.js"
  ])assert.equal(existsSync(new URL(path,import.meta.url)),false,path);
});

test("Shuvi command chat is the only mounted chat; legacy cloud route stays isolated",()=>{
  const main=source("main.ts"),online=source("online-chat.ts"),settings=readApi("online-status.js");
  assert.match(main,/mountChatWorkspace/);
  assert.doesNotMatch(main,/mountOnlineChat/);
  assert.match(main,/mountAITeamWebPlanner\(\)/);
  // The old opt-in cloud implementation is retained in source for
  // compatibility, but must not appear as a separate Vercel chat tab.
  assert.match(online,/\/api\/online-chat/);
  assert.match(settings,/onlineAI:/);
});

test("Balanced AI team remains operational in UI without removed Telegram selectors",()=>{
  const ui=source("ai-team-web-planner.ts"),styles=source("ai-team.css"),main=source("main.ts");
  assert.match(main,/\.\/ai-team\.css/);
  for(const role of ["master","launcher","project","coding","video","image","video_gen","blender","motion","vision","reviewer"]){
    assert.match(ui,new RegExp('id: "'+role+'"'));
  }
  assert.match(styles,/shuvi-team-grid/);
  assert.match(styles,/shuvi-route-preview/);
  assert.match(styles,/max-width:580px/);
  assert.doesNotMatch(styles,/shuvi-telegram-/);
  assert.match(ui,/scope:"browser_preferences_only"/);
  assert.match(ui,/localStorage\.setItem\(TEAM_KEY/);
  assert.doesNotMatch(ui,/execute_action|telegram_send_message|provider_api_key/i);
});

test("Web chat stays browser-local: same account is NOT a shared sync login",()=>{
  const online=source("online-chat.ts");
  assert.match(online,/localStorage\.getItem\(CHAT_KEY\)/);
  assert.match(online,/localStorage\.setItem\(CHAT_KEY/);
  assert.doesNotMatch(online,/google.*oauth|supabase.auth|signInWith/i);
});
