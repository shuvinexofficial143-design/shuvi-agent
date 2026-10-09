import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lease=readFileSync(new URL("../src-tauri/src/execution_lease.rs",import.meta.url),"utf8");
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("A09 Windows desktop lease extends beyond single Shuvi process",()=>{
 assert.match(lease,/share_mode\(0\)/);
 assert.match(lease,/native-desktop-action-v1\.lock/);
 assert.match(lease,/windows_lease_path\(\)/);
 assert.match(lease,/is_windows_reparse_point\(&folder_meta\)/);
 assert.match(lease,/is_windows_reparse_point\(&meta\)/);
 assert.match(lease,/cross_process:Option<File>/);
 assert.match(lease,/drop\(self\.cross_process\.take\(\)\)/);
});
test("A09 cross-process denial never retains in-process slot",()=>{
 assert.match(lease,/active\.compare_exchange\(false,true,Ordering::AcqRel,Ordering::Acquire\)/);
 assert.match(lease,/Err\(error\)=>\{/);
 assert.match(lease,/active\.store\(false,Ordering::Release\)/);
 assert.match(lease,/two_independent_shuvi_instances_cannot_acquire_windows_desktop_simultaneously/);
 assert.match(lease,/a_denied_cross_process_claim_cannot_poison_existing_instance/);
});
test("A09 main native actions and all bridge lifecycle endpoints use same cross-instance lease",()=>{
 const execution=native.slice(native.indexOf("async fn execute_action("),native.indexOf("async fn execute_powershell("));
 assert.match(execution,/execution_lease::claim_single_execution\(&state.native_execution_owned\)/);
 for(const app of ["premiere","photoshop","audition","animate","illustrator"]){
  for(const op of ["start","stop"]){
   const start=native.indexOf("fn "+app+"_bridge_"+op+"(");
   const end=native.indexOf("\n}",start);
   assert.ok(start>=0&&end>start);
   assert.match(native.slice(start,end),/execution_lease::claim_single_execution\(&state.native_execution_owned\)/);
  }
 }
});
