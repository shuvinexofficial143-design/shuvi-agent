import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (name) => readFileSync(new URL("../src/" + name,import.meta.url),"utf8");

test("Telegram setup appears in Shuvi Settings and never handles bot token in public UI",()=>{
  const ui=source("telegram-web-setup.ts");
  const main=source("main.ts");
  assert.match(main,/mountTelegramWebSettings\(\)/);
  assert.match(ui,/view-settings/);
  assert.match(ui,/BotFather/);
  assert.match(ui,/Save bot username/);
  assert.match(ui,/only in Shuvi Desktop/);
  assert.doesNotMatch(ui,/localStorage\.setItem\([^\n]*token/i);
  assert.doesNotMatch(ui,/fetch\(.*api\.telegram\.org/);
});

test("AI team models have unique worker roles and cannot dispatch native work",()=>{
  const ui=source("ai-team-web-planner.ts");
  const main=source("main.ts");
  assert.match(main,/mountAITeamWebPlanner\(\)/);
  for(const role of ["master","launcher","project","coding","video","image","video_gen","blender"]){
    assert.match(ui,new RegExp('id: "'+role+'"'));
  }
  assert.match(ui,/scope:"browser_preferences_only"/);
  assert.match(ui,/localStorage\.setItem\(TEAM_KEY/);
  assert.doesNotMatch(ui,/execute_action|telegram_send_message|provider_api_key/i);
});

test("Both Telegram and AI team remain disabled as runtime controls when host is offline",()=>{
  const telegram=source("telegram-web-setup.ts");
  const agents=source("ai-team-web-planner.ts");
  assert.match(telegram,/waiting for the native app/);
  assert.match(agents,/No models invoked/);
  assert.match(agents,/activeWorkers:0/);
  assert.match(telegram,/No Bot Token is required on this website/);
});

test("Panel styles are responsive and mounted from dashboard entrypoint",()=>{
  const main=source("main.ts"),css=source("telegram-team.css");
  assert.match(main,/\.\/telegram-team\.css/);
  assert.match(css,/max-width:580px/);
  assert.match(css,/shuvi-team-grid/);
  assert.match(css,/shuvi-telegram-columns/);
});