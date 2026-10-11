import test from "node:test";
import assert from "node:assert/strict";
import {isRecoverableUiReadFailure,isAuditedUiReadFailure} from "../src/native-read-recovery.mjs";

const id="action-verified-1";
const receipt={action_id:id,tool:"ui_find",event:"failed",success:false};
test("only definite read-only UI lookup and discovery failures are eligible",()=>{
 for(const message of ["UI lookup failed: Requested top-level window was not found.",
  "No matching UI element found", "UI discovery failed: controls inaccessible",
  "Ambiguous window identity"]){
  assert.equal(isRecoverableUiReadFailure("ui_find",message),true);
 }
 assert.equal(isRecoverableUiReadFailure("ui_discover","UI discovery failed: window missing"),true);
 for(const tool of ["ui_click","ui_send_keys","premiere_launch","inspect_screen","write_file","ui_windows"]){
  assert.equal(isRecoverableUiReadFailure(tool,"UI lookup failed: timeout"),false);
 }
 assert.equal(isRecoverableUiReadFailure("ui_find","network error"),false);
 assert.equal(isRecoverableUiReadFailure("ui_find",null),false);
});
test("exact native failed audit receipt is required; model text never proves failure",()=>{
 const msg="UI lookup failed: Requested top-level window was not found.";
 assert.equal(isAuditedUiReadFailure("ui_find",msg,id,receipt,false),true);
 assert.equal(isAuditedUiReadFailure("ui_find",msg,id,receipt,true),false);
 assert.equal(isAuditedUiReadFailure("ui_find",msg,"different",receipt,false),false);
 assert.equal(isAuditedUiReadFailure("ui_discover",msg,id,receipt,false),false);
 assert.equal(isAuditedUiReadFailure("ui_find",msg,id,{...receipt,event:"executed",success:true},false),false);
 assert.equal(isAuditedUiReadFailure("ui_find",msg,id,{...receipt,event:"unknown"},false),false);
 assert.equal(isAuditedUiReadFailure("ui_find",msg,id,null,false),false);
 assert.equal(isAuditedUiReadFailure("ui_find","arbitrary external failure",id,receipt,false),false);
});
