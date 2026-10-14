import test from "node:test";import assert from "node:assert/strict";
import {validPreparedApproval as ok} from "../src/native-prepared-approval.mjs";
const valid={summary:"Click New Project",detail:"In an observed Premiere window",risk:"medium"};
test("Batch 94 no owner approval is rendered with missing or oversized permission details",()=>{
 assert.equal(ok(valid),true);
 for(const value of [
  {...valid,summary:""},{...valid,risk:" "},{...valid,detail:null},
  {...valid,summary:"x".repeat(701)},{...valid,detail:"x".repeat(2401)},
  {...valid,risk:"x".repeat(301)}
 ]) assert.equal(ok(value),false);
});

test("Batch 98 an approval preview cannot hide control or direction characters",()=>{
 assert.equal(ok({...valid,summary:"Click\u202eCancel"}),false);
 assert.equal(ok({...valid,detail:"Save\u0000 project"}),false);
 assert.equal(ok({...valid,risk:"Low\u2066High\u2069"}),false);
 assert.equal(ok({...valid,detail:"Step 1\nStep 2"}),true);
});
