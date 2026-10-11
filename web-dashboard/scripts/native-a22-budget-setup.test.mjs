import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const root=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const web=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Windows Settings lets owner choose exact AI models without mandatory billing form",()=>{
 const setup=web("src/native-model-setup.ts");
 const native=web("src/native-agent.ts");
 assert.match(setup,/window\.localStorage\.setItem\(STORAGE,JSON\.stringify\(config\)\)/);
 assert.match(setup,/save_api_key/);
 assert.match(setup,/api_key_status/);
 assert.match(native,/chooseNativeRoute\([^\n]*team\?\.current\(\)\)/);
 assert.match(native,/waitingForChoice\?"@master "\+text:text/);
 assert.equal(existsSync(new URL("../src/native-budget-setup.ts",import.meta.url)),false);
});
test("Native provider credentials and tool approvals remain in Windows app",()=>{
 const lib=root("src-tauri/src/lib.rs");
 assert.match(lib,/fn api_key_status/);
 assert.match(lib,/fn save_api_key/);
 assert.match(lib,/fn prepare_tool/);
 assert.match(lib,/fn deny_action/);
});
