import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const uxp=readFileSync("integrations/premiere-uxp/main.js","utf8");
const native=readFileSync("src-tauri/src/lib.rs","utf8");
const sha=readFileSync("src-tauri/src/premiere_media_relink.rs","utf8");
const bridge=readFileSync("src-tauri/src/premiere_bridge.rs","utf8");
function extract(start,end,name,deps) {
  const i=uxp.indexOf(start),j=uxp.indexOf(end,i);
  assert.ok(i>=0&&j>i, "exact UXP function boundaries");
  return new Function(...Object.keys(deps),'"use strict";\n'+uxp.slice(i,j)+'\nreturn '+name+';')
    (...Object.values(deps));
}
const original="C:\\media\\old.mp4",replacement="C:\\media\\replacement.mp4";
function host(oldPath=original,afterOffline=false) {
  let mediaPath=oldPath, changes=0;
  const clip={
    getId:async()=> "project-item-42",
    canChangeMediaPath:async()=>true,
    getMediaFilePath:async()=>mediaPath,
    changeMediaFilePath:async (path,override)=>{changes++; mediaPath=path; return true;},
    isOffline:async()=>afterOffline
  };
  const root={getItems:async()=>[clip]};
  const project={guid:"project-identity",path:"C:\\Projects\\edit.prproj",
    getRootItem:async()=>root,save:()=>{throw Error("Unexpected save in host-only relink");}};
  const deps={
    requireProject:async()=>project,
    findProjectItemById:async(_root,id)=>id==="project-item-42"?clip:null,
    asClipProjectItem:item=>item===clip?item:null,
    asFolderItem:()=>null,
    projectItemId:async item=>item.getId(),
    normalizeMediaPath:x=>String(x||"").replaceAll("/","\\").toLowerCase(),
    plainGuid:x=>x
  };
  const relink=extract("async function relinkMedia(argumentsValue)","\nasync function attachProxy","relinkMedia",deps);
  const audit=extract("async function inspectProjectMediaAudit()","\nasync function relinkMedia(argumentsValue)","inspectProjectMediaAudit",deps);
  return {relink,audit,changes:()=>changes,path:()=>mediaPath};
}
test("read-only inventory yields exact native media ID, old path and offline flag",async()=>{
  const h=host();
  const report=await h.audit();
  assert.equal(report.projectGuid,"project-identity");
  assert.equal(report.projectPath,"C:\\Projects\\edit.prproj");
  assert.equal(report.scanComplete,true);
  assert.equal(report.entries.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(report.entries[0])),{
    itemId:"project-item-42",name:"",mediaPath:original,offline:false});
  assert.equal(h.changes(),0);
  assert.equal(report.editingAuthorized,false);
});
test("relink refuses stale old-path without invoking Adobe mutation",async()=>{
  const h=host();
  await assert.rejects(h.relink({itemId:"project-item-42",newPath:replacement,
    expectedPreviousPath:"C:\\media\\another.mp4"}),/source changed/);
  assert.equal(h.changes(),0);
});
test("relink refuses no-op and missing original media evidence",async()=>{
  const h=host();
  await assert.rejects(h.relink({itemId:"project-item-42",newPath:original,
    expectedPreviousPath:original}),/no-op/);
  await assert.rejects(h.relink({itemId:"project-item-42",newPath:replacement}),/required/);
  assert.equal(h.changes(),0);
});
test("relink native success is conditioned on exact item/path plus online readback",async()=>{
  const h=host();
  const result=await h.relink({itemId:"project-item-42",newPath:replacement,
    expectedPreviousPath:original,overrideCompatibility:false});
  assert.equal(h.changes(),1);
  assert.equal(result.observedId,"project-item-42");
  assert.equal(result.observedOffline,false);
  assert.equal(result.verificationStatus,"verified_readback");
  assert.equal(result.retrySafe,false);
});
test("relink remains unverified if Premiere still calls footage offline",async()=>{
  const h=host(original,true);
  const result=await h.relink({itemId:"project-item-42",newPath:replacement,
    expectedPreviousPath:original});
  assert.equal(result.relinked,true);
  assert.equal(result.observedOffline,true);
  assert.equal(result.verificationStatus,"accepted_unverified");
  assert.equal(result.uncertain,true);
});
test("Rust relink enforces approved expected original path, before/after SHA256 and save proof",()=>{
  assert.match(native,/expected_previous_path=arg_string\(&proposal\.arguments,"expected_previous_path"\)/);
  assert.match(native,/premiere_media_relink::fingerprint\(&new_path\)/);
  assert.match(native,/premiere_media_relink::same_file\(&media_before,f\)/);
  assert.match(native,/backup_premiere_project\(&premiere_bridge\)\.await\?/);
  assert.match(native,/project_persistence::fingerprint\(&project_path\)/);
  assert.match(native,/request\("save_project"/);
  assert.match(native,/request\("inspect_media_interpretation"/);
  assert.match(native,/"durable_relink_verified":durable/);
  assert.match(native,/"retry_safe":false/);
  assert.match(sha,/Sha256::new\(\)/);
  assert.match(sha,/MAX_MEDIA_BYTES:u64=4\*1024\*1024\*1024/);
  assert.match(sha,/file\.read\(&mut buffer\)/);
  assert.match(sha,/same_file\(a:&MediaFingerprint,b:&MediaFingerprint\)/);
  assert.match(bridge,/"inspect_project_media_audit"/);
});
test("read-only audit is a distinct registered low risk native tool",()=>{
  assert.match(native,/"premiere_media_audit"/);
  assert.match(native,/ToolAction::PremiereMediaAudit/);
  assert.match(native,/RiskLevel::Low/);
  assert.match(uxp,/case "inspect_project_media_audit":/);
  assert.match(uxp,/inspectionOnly:true,editingAuthorized:false/);
});

test("persisted project media audit is read-only and requires exact four-way evidence",()=>{
  const start=native.indexOf('ToolAction::PremiereVerifySavedMedia{project_path');
  const end=native.indexOf('ToolAction::PremiereRelinkMedia { item_id, new_path',start);
  assert.ok(start>=0&&end>start);
  const verify=native.slice(start,end);
  assert.match(verify,/premiere_project_lifecycle::preflight_open/);
  assert.match(verify,/premiere_media_relink::fingerprint/);
  assert.match(verify,/request\("inspect_context"/);
  assert.match(verify,/request\("inspect_media_interpretation"/);
  assert.match(verify,/assess_saved_media/);
  assert.match(verify,/files_unchanged/);
  assert.match(verify,/fresh_session_proven":false/);
  assert.doesNotMatch(verify,/request\("save_project"/);
  assert.doesNotMatch(verify,/request\("relink_media"/);
  assert.match(sha,/host_project_identity_matches/);
  assert.match(sha,/disk_project_fingerprint_matches/);
  assert.match(sha,/media_source_sha256_matches/);
  assert.match(sha,/host_media_item_online_matches/);
  assert.match(native,/"premiere_verify_saved_media"/);
});
