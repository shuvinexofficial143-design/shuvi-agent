import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyNativeIntent,chooseNativeRoute} from "../web-dashboard/src/native-model-routing.mjs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const native=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("WhatsApp Desktop tool is recognized and requires explicit approval",()=>{
 assert.match(rust,/\|\s*"whatsapp_desktop_open"/);
 assert.match(rust,/\"whatsapp_desktop_open\" => \{/);
 assert.match(rust,/ToolAction::WhatsAppDesktopOpen => \{/);
 assert.match(rust,/whatsapp_desktop_open accepts no arguments/);
 assert.match(rust,/stage_tool\(proposal, Some\(provider_context\), state\.inner\(\)\)/);
 assert.match(native,/invoke<Pending>\("prepare_tool"/);
 assert.match(native,/invoke<ActionResult>\("execute_action"/);
 assert.match(native,/Allow once/);
});
test("installed WhatsApp route uses assigned model and never silently chooses another",()=>{
 assert.equal(classifyNativeIntent("Open WhatsApp"),"whatsapp");
 assert.equal(classifyNativeIntent("WhatsApp खोलो"),"whatsapp");
 assert.equal(classifyNativeIntent("What is WhatsApp?"),"chat");
 assert.equal(chooseNativeRoute("Open WhatsApp",{provider:"xkiro",roles:{chat:"mistral/mistral-large"}}).ok,false);
});
test("desktop launch is fixed, local, and does not falsely claim UI window or message verified",()=>{
 assert.match(rust,/Get-StartApps/);
 assert.match(rust,/SHUVI_WHATSAPP_DESKTOP_LAUNCH_REQUESTED/);
 assert.match(rust,/Verify its visible window with ui_find or inspect_screen/);
 assert.doesNotMatch(rust,/https:\/\/web\.whatsapp\.com/);
});
