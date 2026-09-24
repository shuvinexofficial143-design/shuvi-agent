import vm from "node:vm";
import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function fixture({ame=true,accepted=true}={}) {
  let exports=0;
  let activeSequence={guid:"sequence-A",name:"Main"};
  const project={guid:"project-A",path:"C:/project.prproj",getActiveSequence:async()=>activeSequence};
  const manager={isAMEInstalled:ame,exportSequence:async()=>{exports++;return accepted;}};
  const premiere={Project:{getActiveProject:async()=>project},EncoderManager:{getManager:()=>manager},
    Constants:{ExportType:{QUEUE_TO_AME:2,IMMEDIATELY:1}}};
  const panel={document:{getElementById:()=>null},require:name=>name==="premierepro"?premiere:
    name==="uxp"?{entrypoints:{setup(){}}}:{},setInterval:()=>0};
  vm.createContext(panel);
  vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8"),panel);
  const expected={project_guid:"project-A",project_path:"C:/project.prproj",sequence_guid:"sequence-A",clips:[]};
  const args={output:"C:/exports/final.mp4",preset:null,queueToAme:false,overwrite:false,_expected:expected};
  return {panel,args,project,manager,expected,get exports(){return exports;},
    set sequence(value){activeSequence=value;}};
}

test("read-only export inspection returns exact identity and AME capability",async()=>{
  const f=fixture();const result=await f.panel.executeCommand({action:"inspect_export",arguments:{}});
  assert.equal(result.projectGuid,"project-A");assert.equal(result.sequenceGuid,"sequence-A");
  assert.equal(result.ameAvailable,true);assert.equal(result.defaultPresetDetailsInspectable,false);assert.equal(f.exports,0);
});
test("immediate boolean acceptance never claims encoding completion",async()=>{
  const f=fixture();const result=await f.panel.executeCommand({action:"export_sequence",arguments:f.args});
  assert.equal(result.state,"accepted");assert.equal(result.completionVerified,false);assert.equal(result.accepted,true);
  assert.equal(f.exports,1);
});
test("AME acceptance is queued, not rendered",async()=>{
  const f=fixture();const result=await f.panel.executeCommand({action:"export_sequence",arguments:{...f.args,queueToAme:true}});
  assert.equal(result.state,"queued");assert.equal(result.completionVerified,false);assert.equal(result.ameAvailable,true);
  assert.equal(f.exports,1);
});
test("AME unavailable refuses before export",async()=>{
  const f=fixture({ame:false});
  await assert.rejects(f.panel.executeCommand({action:"export_sequence",arguments:{...f.args,queueToAme:true}}),/not installed/);
  assert.equal(f.exports,0);
});
test("project and sequence changes reject before export",async()=>{
  const f=fixture();f.project.guid="other";
  await assert.rejects(f.panel.executeCommand({action:"export_sequence",arguments:f.args}),/project changed/);
  assert.equal(f.exports,0);
  f.project.guid="project-A";f.sequence={guid:"sequence-B",name:"Other"};
  await assert.rejects(f.panel.executeCommand({action:"export_sequence",arguments:f.args}),/sequence changed/);
  assert.equal(f.exports,0);
});
test("export requires whole-sequence expectation and rejects native false",async()=>{
  const f=fixture({accepted:false});
  await assert.rejects(f.panel.executeCommand({action:"export_sequence",arguments:{...f.args,_expected:undefined}}),/requires an exact project/);
  await assert.rejects(f.panel.exportSequence({...f.args,_expected:{...f.expected,clips:[{kind:"video"}]}}),/requires an exact project/);
  await assert.rejects(f.panel.executeCommand({action:"export_sequence",arguments:f.args}),/rejected the export request/);
  assert.equal(f.exports,1);
});
