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
