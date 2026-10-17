import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const p=path=>readFileSync(new URL("../src-tauri/src/"+path,import.meta.url),"utf8");
const delivery=p("native_task_delivery.rs");
const cert=p("native_blender_action_artifact.rs");
test("two verification threads require distinct actual OS file identities",()=>{
 assert.match(delivery,/fn physical_file_id/);
 assert.match(delivery,/GetFileInformationByHandle/);
 assert.match(delivery,/same_physical_output\(&first_path,&second_path\)\?/);
 assert.match(delivery,/real_hard_links_share_one_physical_identity_and_never_enter_two_workers/);
 assert.match(delivery,/std::thread::scope/);
});
test("Windows SHA256 readers forbid concurrent writer/delete share during bounded rehash",()=>{
 for(const source of [delivery,cert]){
   assert.match(source,/share_mode\(0x00000001\)/);
   assert.match(source,/modified\(\)\.ok\(\)/);
   assert.match(source,/fs::symlink_metadata/);
 }
 assert.match(delivery,/physical_file_id\(&final_path\)\?!=original_id/);
 assert.match(delivery,/replaced_file_identity_is_rejected_even_with_equal_size/);
 assert.match(cert,/Blender output changed or was replaced while rehashing/);
});
