import test from "node:test";import assert from "node:assert/strict";
import {verifiedExecutionReceipt as verified,contradictsFailureReceipt as conflict} from "../src/native-action-receipts.mjs";
const action={id:"a-1",kind:"ui_find"},result={success:true,tool:"ui_find"};
const good={action_id:"a-1",tool:"ui_find",event:"executed",success:true};
test("exact original approved action ID and tool kind are required",()=>{
 assert.equal(verified(action,result,[good]),true);
 assert.equal(verified(action,result,[{...good,event:"prepared",success:true},good]),true);
 assert.equal(verified(action,result,[{...good,event:"approved",success:true},good]),true);
 assert.equal(verified(action,{success:true,tool:"ui_click"},[good]),false);
 assert.equal(verified(action,result,[{...good,tool:"ui_click"}]),false);
 assert.equal(verified({...action,id:"other"},result,[good]),false);
 assert.equal(verified(action,result,[{...good,success:false}]),false);
});
test("success and failure on same action ID are contradictory, never verified",()=>{
 assert.equal(verified(action,result,[good,{...good,event:"failed",success:false}]),false);
 assert.equal(verified(action,result,[good,{...good,tool:"ui_click"}]),false);
 assert.equal(conflict(action,[good]),true);
 assert.equal(conflict(action,[{...good,event:"failed",success:false}]),false);
 assert.equal(conflict(action,[{...good,tool:"ui_click",event:"failed",success:false}]),true);
 assert.equal(conflict(action,[{...good,action_id:"different"}]),false);
});

test("Batch 33 conflicting nonzero native exit code cannot count as audited success",()=>{
 assert.equal(verified(action,{...result,exit_code:1},[good]),false);
 assert.equal(verified(action,{...result,exit_code:0},[good]),true);
 assert.equal(verified(action,{...result,exit_code:null},[good]),true);
});

test("Batch 35 denied or any executed record cannot co-authorize failed UI recovery",()=>{
 assert.equal(conflict(action,[{...good,event:"denied",success:false}]),true);
 assert.equal(conflict(action,[{...good,event:"executed",success:false}]),true);
 assert.equal(conflict(action,[{...good,event:"failed",success:false}]),false);
 assert.equal(conflict(action,[{...good,event:"prepared",success:true}]),false);
});

test("Batch 73 success receipts fail closed on malformed exit status serialization",()=>{
 for(const status of ["0","1",false,true,NaN,0.5,-1])
  assert.equal(verified(action,{...result,exit_code:status},[good]),false,String(status));
 assert.equal(verified(action,{...result,exit_code:0},[good]),true);
 assert.equal(verified(action,{...result,exit_code:null},[good]),true);
 assert.equal(verified(action,result,[good]),true);
});

test("Batch 89 a blank or oversized prepared action identity cannot be audit-verified",()=>{
 for(const id of [" ","","a".repeat(129)]){
  assert.equal(verified({...action,id},result,[{...good,action_id:id}]),false);
 }
 assert.equal(verified({...action,id:" a-1 "},result,[{...good,action_id:" a-1 "}]),true);
});
