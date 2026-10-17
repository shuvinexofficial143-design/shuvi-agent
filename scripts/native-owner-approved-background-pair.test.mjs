import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const lib=read("src-tauri/src/lib.rs");
const lane=read("src-tauri/src/native_background_os_workers.rs");
const schedule=read("src-tauri/src/native_scheduler.rs");
test("native read-only SHA pair must be staged through Shuvi's existing owner Allow-once gate",()=>{
 assert.match(lib,/VerifyReadOnlyShaPair \{[\s\S]*first_path: String, first_sha256: String,[\s\S]*second_path: String, second_sha256: String/);
 assert.match(lib,/"verify_readonly_sha_pair" => \{/);
 // Parser allowlist must also recognize the exact tool; otherwise the model
 // could propose a valid action but its typed approval would never be staged.
 assert.match(lib,/\| "verify_readonly_sha_pair"/);
 assert.match(lib,/For two read-only binary files that the owner specifically wants SHA-256 verified/);

 assert.match(lib,/RiskLevel::Medium\)\s*\}\s*"write_file" =>/);
 assert.match(lib,/exact\.len\(\)!=4/);
 assert.match(lib,/!sha_ok\(&first_sha256\)\|\|!sha_ok\(&second_sha256\)/);
 assert.match(lib,/first_path\.eq_ignore_ascii_case\(&second_path\)/);
 assert.match(lib,/native_worker_job::begin\(&app,&action_id,&active_tool,now_ms\(\)\)\?/);
 const verified=lib.indexOf("let execution=if let ToolAction::VerifyReadOnlyShaPair");
 const approved=lib.indexOf("let action = action.ok_or_else");
 assert.ok(approved>=0&&verified>approved);
 assert.match(lib,/ToolAction::VerifyReadOnlyShaPair \{\.\.\} =>\s*Err\("SHA pair requires the existing exact approved native execute_action path/);
});
test("approved owner action maps deterministically to two independent UUID/PID SHA workers",()=>{
 assert.match(lib,/format!\("shuvi-readonly-pair-v1:\{\}:\{\}",action_id,index\)/);
 assert.match(lib,/raw\[6\]=\(raw\[6\]&0x0f\)\|0x40/);
 assert.match(lib,/raw\[8\]=\(raw\[8\]&0x3f\)\|0x80/);
 assert.match(lib,/run_internal_readonly_pair\(/);
 assert.match(lib,/let verified_left=left\?/);
 assert.match(lib,/let verified_right=right\?/);
 assert.match(lib,/"readOnlySha256Verified":true/);
 assert.match(lib,/"applicationVerified":false/);
 assert.match(lib,/"desktopMutated":false/);
 assert.match(lane,/pub\(crate\) fn run_internal_readonly_pair</);
 assert.match(lane,/pub\(crate\) struct PreparedReadOnlySha</);
 assert.match(schedule,/More than one native action has claimed the shared desktop/);
});
test("a pair never escapes host-wide 4 GiB memory accounting despite its two unregistered 512 MiB children",()=>{
 assert.match(lib,/let owner_ram=\|\|->Result<bool,String>\{/);
 assert.match(lib,/status\.shuvi_memory_mb\+1024\.0>=HARD_LIMIT_MB/);
 assert.match(lib,/if owner_ram\(\)\?/);
 assert.match(lane,/fn run_trusted_sha256_with_guard</);
 assert.match(lane,/READ_ONLY_JOB_CAP:u64=512\*1024\*1024/);
});
