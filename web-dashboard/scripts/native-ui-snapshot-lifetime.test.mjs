import test from "node:test";import assert from "node:assert/strict";
import {invalidatesObservedWindows,requiresNewWindowObservation} from "../src/native-ui-snapshot-lifetime.mjs";
test("audited mutations invalidate previously seen UI window snapshot",()=>{
 for(const tool of ["ui_click","ui_set_value","ui_send_keys","premiere_launch"])
  assert.equal(requiresNewWindowObservation(true,tool),true);
 for(const tool of ["ui_windows","ui_find","ui_discover","premiere_detect"])
  assert.equal(invalidatesObservedWindows(tool),false);
 assert.equal(requiresNewWindowObservation(false,"ui_click"),false);
});
