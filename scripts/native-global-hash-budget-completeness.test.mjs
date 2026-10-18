import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
function functionBody(name){
 const begin=source.indexOf(name);
 assert.ok(begin>=0,name);
 const end=source.indexOf("\n}\n",begin);
 assert.ok(end>begin,name);
 return source.slice(begin,end);
}
test("all five final-delivery extra hashing paths consume a global OS slot",()=>{
 const publish=functionBody("pub(crate) fn finalize(");
 const inspect=functionBody("pub(crate) fn read(");
 assert.match(publish,/fill_missing_blender_artifacts\(&mut steps,\|id\|\{\s*let _hash_slot=global_hash_slots::HashSlot::take\(&global_pool\)\?/);
 assert.match(publish,/fill_blender_plan_provenance\(&mut steps,\|id\|\{\s*let _hash_slot=global_hash_slots::HashSlot::take\(&global_pool\)\?/);
 assert.match(publish,/if a\.bytes==0 \{\s*let _hash_slot=global_hash_slots::HashSlot::take\(&global_pool\)\?;\s*a\.bytes=file_hash\(/);
 assert.match(publish,/let _hash_slot=global_hash_slots::HashSlot::take\(&global_pool\)\?;\s*verify_blender_certificates\(app,&receipt\.steps\)\?/);
 assert.match(inspect,/if let Some\(a\)=step\.artifact\.as_ref\(\)\{\s*let _hash_slot=global_hash_slots::HashSlot::take\(&global_pool\)\?;\s*check_artifact\(/);
 assert.match(inspect,/let _hash_slot=global_hash_slots::HashSlot::take\(&global_pool\)\?;\s*verify_blender_certificates\(app,&stored\.steps\)\?/);
});
test("actual two-thread delivery verification and source audits retain bounded hashing",()=>{
 const verified=functionBody("fn verify_with_pool<");
 assert.match(verified,/verify_artifacts_bounded\(steps,\|artifact,tool\|/);
 assert.match(verified,/global_hash_slots::HashSlot::take\(dir\)\?/);
 assert.match(verified,/check_artifact\(artifact,tool\)/);
 const publish=functionBody("pub(crate) fn finalize(");
 assert.ok(publish.indexOf("verify_with_pool(")<publish.lastIndexOf("publish_at("));
 assert.ok(publish.indexOf("verify_blender_certificates(")<publish.lastIndexOf("publish_at("));
 assert.match(publish,/verify_blender_certificates\(app,&receipt\.steps\)\?/);
});
