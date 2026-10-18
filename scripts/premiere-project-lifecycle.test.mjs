import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const uxp=readFileSync("integrations/premiere-uxp/project-lifecycle.js","utf8");
const main=readFileSync("integrations/premiere-uxp/main.js","utf8");
const bridge=readFileSync("src-tauri/src/premiere_bridge.rs","utf8");
const native=readFileSync("src-tauri/src/premiere_project_lifecycle.rs","utf8");
const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const module={exports:{}};
runInNewContext(uxp,{module,exports:module.exports});
const lifecycle=module.exports;

test("new/existing Adobe project paths require bounded clean Windows .prproj",()=>{
  assert.equal(lifecycle.checkedPath("C:\\Projects\\new.prproj"),"C:\\Projects\\new.prproj");
  assert.equal(lifecycle.checkedPath("\\\\server\\share\\a.prproj"),"\\\\server\\share\\a.prproj");
  for(const path of ["C:\\Projects\\a.mp4","../a.prproj","C:\\X\\..\\a.prproj",
    "C:\\a.prproj\n", "C:\\a.prproj ", "/tmp/linux.prproj", "a.prproj",
    "C:\\\\", "", 100]) assert.throws(()=>lifecycle.checkedPath(path));
});

function hostFixture({mode="create",saveOk=true,activeMatches=true}={}){
  let current=null;
  const calls=[];
  const project={
    guid:"new-project-guid",path:"C:\\Projects\\new.prproj",name:"new",
    save:async()=>{calls.push("save");return saveOk;}
  };
  const old={guid:"old-project-guid",path:"C:\\Projects\\old.prproj"};
  const api={
    getActiveProject:async()=>{calls.push("active");return current===null?old:(activeMatches?project:old);},
    createProject:async path=>{calls.push("create:"+path);current=project;return project;},
    open:async path=>{calls.push("open:"+path);current=project;return project;}
  };
  return {api,calls,project,mode};
}

test("real Adobe create handler saves only new project and requires active native identity",async()=>{
  const f=hostFixture();
  const value=await lifecycle.createProject(f.api,{path:f.project.path},id=>id);
  assert.equal(value.projectIdentityVerified,true);
  assert.equal(value.initialSaveAccepted,true);
  assert.equal(value.persistenceVerified,false); // independent Rust disk check required
  assert.equal(value.reopenVerified,false);
  assert.equal(value.retrySafe,false);
  assert.deepEqual(f.calls,["active","create:"+f.project.path,"save","active"]);
});

test("create save failure cannot be treated as absent project or blindly retried",async()=>{
  const f=hostFixture({saveOk:false});
  await assert.rejects(lifecycle.createProject(f.api,{path:f.project.path},id=>id),/uncertain/);
  assert.deepEqual(f.calls,["active","create:"+f.project.path,"save"]);
  const mismatch=hostFixture({activeMatches:false});
  const result=await lifecycle.createProject(mismatch.api,{path:mismatch.project.path},id=>id);
  assert.equal(result.projectIdentityVerified,false);
  assert.equal(result.verificationStatus,"accepted_unverified");
});

test("real Adobe open handler only opens; never saves or closes the previous project",async()=>{
  const f=hostFixture();
  const value=await lifecycle.openProject(f.api,{path:f.project.path},id=>id);
  assert.equal(value.projectIdentityVerified,true);
  assert.equal(value.initialSaveAccepted,false);
  assert.equal(value.persistenceVerified,false);
  assert.equal(value.retrySafe,false);
  assert.deepEqual(f.calls,["active","open:"+f.project.path,"active"]);
  const bad=hostFixture({activeMatches:false});
  const uncertain=await lifecycle.openProject(bad.api,{path:bad.project.path},id=>id);
  assert.equal(uncertain.projectIdentityVerified,false);
});

test("both operations are routed through existing audited native tools and authenticated allowlist",()=>{
  assert.match(main,/require\("\.\/project-lifecycle\.js"\)/);
  assert.match(main,/case "create_project":/);
  assert.match(main,/case "open_project":/);
  assert.match(bridge,/"create_project", "open_project"/);
  for(const t of ["premiere_create_project","premiere_open_project"]){
    assert.ok(desktop.includes('"' + t + '"'),t);
    assert.match(desktop,new RegExp(t+"[\\s\\S]*?RiskLevel::High"));
  }
  for(const v of ["PremiereCreateProject","PremiereOpenProject"]){
    assert.match(desktop,new RegExp("ToolAction::"+v));
  }
  assert.match(desktop,/mod premiere_project_lifecycle;/);
  assert.match(desktop,/premiere_project_lifecycle::preflight_create\(&path\)/);
  assert.match(desktop,/premiere_project_lifecycle::preflight_open\(&path\)/);
  const createArm=desktop.slice(desktop.indexOf('ToolAction::PremiereCreateProject{path} => {'),
    desktop.indexOf('ToolAction::PremiereOpenProject{path} => {'));
  const openArm=desktop.slice(desktop.indexOf('ToolAction::PremiereOpenProject{path} => {'),
    desktop.indexOf('ToolAction::PremiereBridgeStart => {',desktop.indexOf('ToolAction::PremiereOpenProject{path} => {')));
  assert.match(createArm,/state\.premiere_bridge\.request\("create_project"/);
  assert.match(openArm,/state\.premiere_bridge\.request\("open_project"/);
});

test("Rust refuses target overwrite and separates Adobe accepted from verified on-disk bytes",()=>{
  assert.match(native,/preflight_create/);
  assert.match(native,/fs::symlink_metadata\(p\)/);
  assert.match(native,/cannot overwrite an existing file/);
  assert.match(native,/fn no_directory_links/);
  assert.match(native,/premiere_project_persistence::fingerprint/);
  assert.match(native,/projectIdentityVerified/);
  assert.match(native,/initialSaveAccepted/);
  assert.match(native,/disk_unchanged_during_open/);
  assert.match(native,/reopen_verified":false/);
  assert.match(native,/retry_safe":false/);
});

test("Premiere save creates a durable non-overwriting checkpoint BEFORE Adobe save call",()=>{
  const start=desktop.indexOf("ToolAction::PremiereSaveProject => {");
  const end=desktop.indexOf("ToolAction::AfterEffectsCapabilityReport => {",start);
  assert.ok(start>=0&&end>start);
  const save=desktop.slice(start,end);
  const checkpoint=save.indexOf("premiere_checkpoint::create_checkpoint");
  const bridgeSave=save.indexOf('.request("save_project"');
  assert.ok(checkpoint>=0&&bridgeSave>checkpoint);
  assert.match(save,/"pre_save_checkpoint":checkpoint/);
});
