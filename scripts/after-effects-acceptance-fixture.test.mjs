import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../integrations/after-effects-extendscript/acceptance/fixture.jsx",import.meta.url),"utf8");
const runId="a".repeat(32),dir="C:/runs/shuvi-ae-acceptance-"+runId;
function fixture(userProject=null){
  const context=vm.createContext({dir,runId,userProject});
  vm.runInContext(`
    var files={},calls={newProject:0,close:0,save:0,open:0};
    function File(path){this.fsName=path.replace(/\\\\/g,"/");}
    Object.defineProperties(File.prototype,{exists:{get:function(){return !!files[this.fsName];}},
      length:{get:function(){var f=files[this.fsName];return f?f.length||f.raw.length:0;}},
      modified:{get:function(){return new Date(2000);}}});
    File.prototype.open=function(){return this.exists;};File.prototype.read=function(){return files[this.fsName].raw;};File.prototype.close=function(){};
    function Folder(path){this.fsName=path;this.name=path.split("/").pop();this.exists=true;}
    var projectPath=dir+"/acceptance.aep";
    files[dir+"/owner.json"]={raw:JSON.stringify({schema_version:1,run_id:runId,project_file:projectPath})};
    function owned(){return {file:null,numItems:0,revision:1,save:function(file){calls.save++;this.file=file;files[file.fsName]={length:123};},
      close:function(){calls.close++;return true;}};}
    var app={version:"host-model",project:userProject,newProject:function(){calls.newProject++;return this.project=owned();},
      open:function(file){calls.open++;this.project=owned();this.project.file=file;return this.project;}};
    var CloseOptions={DO_NOT_SAVE_CHANGES:1};
    var config={schema_version:1,run_id:runId,request_id:"bootstrap-1",fixture_dir:dir,project_file:projectPath,phase:"bootstrap"};
  `,context);
  vm.runInContext(source,context);
  return {context,run:()=>JSON.parse(JSON.stringify(vm.runInContext("ShuviAEAcceptanceFixture.run(config)",context)))};
}
test("AE acceptance bootstrap never closes a saved or nonempty user project",()=>{
  for(const user of [{file:{fsName:"C:/user.aep"},numItems:0},{file:null,numItems:1}]){
    const host=fixture(user);assert.throws(host.run,/user project is open/);
    assert.equal(host.context.calls.newProject,0);assert.equal(host.context.calls.close,0);assert.equal(host.context.calls.save,0);
  }
});
test("AE acceptance bootstrap refuses overwrite and mismatched owner tokens",()=>{
  const host=fixture();host.run();assert.throws(host.run,/already exists/);assert.equal(host.context.calls.newProject,1);
  const bad=fixture();vm.runInContext('config.run_id="b".repeat(32)',bad.context);
  assert.throws(bad.run,/exact fresh disposable/);assert.equal(bad.context.calls.save,0);
});
test("AE fixture reopen requires exact project revision and independent save/checkpoint gates",()=>{
  const host=fixture();host.run();
  vm.runInContext('config.phase="reopen";config.expected_project_revision=1;config.expected_size_bytes=123;config.expected_modified_ms=2000;',host.context);
  assert.throws(host.run,/Save\/checkpoint/);assert.equal(host.context.calls.close,0);
  vm.runInContext('config.saved_file_verified=true;config.checkpoint_verified=true;config.expected_project_revision=2;',host.context);
  assert.throws(host.run,/ownership changed/);assert.equal(host.context.calls.close,0);
  vm.runInContext('config.expected_project_revision=1;',host.context);
  const result=host.run();assert.equal(host.context.calls.close,1);assert.equal(host.context.calls.open,1);
  assert.equal(result.persistence_verified,false);assert.equal(result.runtime_verified,false);assert.equal(result.production_ready,false);
});
