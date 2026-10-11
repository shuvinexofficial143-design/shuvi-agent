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
