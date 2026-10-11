import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const lease=readFileSync(new URL("../src-tauri/src/execution_lease.rs",import.meta.url),"utf8");
test("A09 every Adobe bridge start/stop uses the SAME backend native action slot",()=>{
  assert.match(source,/native_execution_owned: AtomicBool/);
  for(const app of ["photoshop","illustrator","animate","audition","premiere"]){
    for(const action of ["start","stop"]){
      const start=source.indexOf("fn "+app+"_bridge_"+action+"(");
      const end=source.indexOf("\n}",start);
      assert.ok(start>=0&&end>start,app+" "+action+" command missing");
      const block=source.slice(start,end);
      const lock=block.indexOf("execution_lease::claim_single_execution(&state.native_execution_owned)?");
      const call=block.indexOf("state."+app+"_bridge."+action+"()");
      assert.ok(lock>=0&&call>lock,app+" "+action+" must acquire the shared slot before altering bridge state");
    }
  }
});
test("A09 read-only bridge status calls do not hold exclusive editing lease",()=>{
 for(const app of ["photoshop","illustrator","animate","audition","premiere"]){
  const from=source.indexOf("fn "+app+"_bridge_status(");
  const to=source.indexOf("\n}",from);
  assert.ok(from>=0&&to>from);
  const part=source.slice(from,to);
  assert.doesNotMatch(part,/claim_single_execution/);
  assert.match(part,new RegExp("state\\."+app+"_bridge\\.status\\(\\)"));
 }
});
test("A09 single execution slot guards action and bridge lifecycle, with concurrent Rust test",()=>{
 const start=source.indexOf("async fn execute_action(");
 const end=source.indexOf("async fn execute_powershell(",start);
 assert.match(source.slice(start,end),/execution_lease::claim_single_execution\(&state.native_execution_owned\)\?/);
 assert.match(lease,/two_real_threads_cannot_both_edit_desktop_at_once/);
 assert.match(lease,/guard_releases_slot_after_unwinding/);
});


test("A09 workspace selection cannot change while a native desktop action owns the execution lease",()=>{
  const start=source.indexOf("fn set_workspace(");
  const end=source.indexOf("\n}",start);
  assert.ok(start>=0&&end>start,"set_workspace command missing");
  const body=source.slice(start,end);
  assert.match(body,/state: State<'_, ActionState>/,"workspace selection needs backend ActionState");
  const lock=body.indexOf("execution_lease::claim_single_execution(&state.native_execution_owned)?");
  const write=body.indexOf("write_workspace(&app, path.trim())");
  assert.ok(lock>=0&&write>lock,"workspace mutation must wait for the SAME exclusive native desktop lease");
});
