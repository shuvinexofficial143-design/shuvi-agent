import vm from "node:vm";
import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const read=path=>readFileSync("integrations/premiere-uxp/"+path,"utf8");
function commonJs(name,deps={}) {
  const module={exports:{}};
  vm.runInNewContext(read(name),{module,exports:module.exports,
    require:key=>{if(!(key in deps))throw Error("Unknown UXP mock dependency "+key);return deps[key];}});
  return module.exports;
}
const lifecycle=commonJs("project-lifecycle.js");
const mogrt=commonJs("mogrt-workflows.js");
const graphics=commonJs("graphics-batch.js",{"./mogrt-workflows.js":mogrt});
const ticks=value=>({seconds:value,ticks:String(Math.round(value*1000))});
function fixture(options={}) {
  const path="C:\\project\\caption-edit.prproj";
  const entries=[],calls={opens:0,saves:0,writes:0};
  const make=(start,id,text)=>{
    let current=text;
    const param={displayName:"Text",getStartValue:async()=>({value:current}),
      isTimeVarying:async()=>false,areKeyframesSupported:async()=>true,
      createKeyframe:async v=>({value:v}),
      createSetValueAction:()=>{calls.writes++;return ()=>{};}};
    const component={getMatchName:async()=>"native.text",
      getDisplayName:async()=>"Test caption",getParamCount:async()=>1,getParam:async()=>param};
    return {param,setText:v=>{current=v;},getName:async()=>"Graphic "+id,
      getTrackIndex:async()=>0,getStartTime:async()=>ticks(start),getEndTime:async()=>ticks(start+2),
      getDuration:async()=>ticks(2),getInPoint:async()=>ticks(0),getOutPoint:async()=>ticks(2),
      getProjectItem:async()=>({getId:async()=>id}),
      getComponentChain:async()=>({getComponentCount:async()=>1,getComponentAtIndex:async()=>component})};
  };
  const sequence={guid:"sequence1",getVideoTrackCount:async()=>1,getAudioTrackCount:async()=>1,
    getVideoTrack:async()=>({getTrackItems:async()=>entries}),
    getAudioTrack:async()=>({getTrackItems:async()=>[]})};
  let active=null;
  const project={guid:"project1",path,getActiveSequence:async()=>sequence};
  const api={Project:{getActiveProject:async()=>active,
    open:async requested=>{calls.opens++;if(options.refuseOpen)return null;
      if(requested!==path)throw Error("Unexpected reopen file");
      active=project;return project;}},ProjectItem:{cast:item=>item},
    Constants:{TrackItemType:{CLIP:1}}};
  const panel={require:name=>name==="premierepro"?api:name==="uxp"?{entrypoints:{setup(){}}}:
    name==="./project-lifecycle.js"?lifecycle:name==="./mogrt-workflows.js"?mogrt:
    name==="./graphics-batch.js"?graphics:{},
    document:{getElementById:()=>null},setInterval:()=>0,setTimeout:()=>0};
  vm.createContext(panel);vm.runInContext(read("main.js"),panel);
  const manifest={schema_version:1,name:"Captions",template:{source:"library",
    library_name:"Source",element_name:"Style"},
    fields:[{role:"caption_text",component_match_name:"native.text",
      param_display_name:"Text",primitive_type:"string"}]};
  const expected={project_guid:"project1",project_path:path,
    sequence_guid:"sequence1",clips:[]};
  const receipt=(sourceIndex,clipIndex,clip,start)=>{
    const nativeSignature=JSON.stringify(["project1",path,"sequence1","video",0,clipIndex,
      "id"+sourceIndex,"Graphic id"+sourceIndex,String(Math.round(start*1000)),
      String(Math.round((start+2)*1000)),"0","2000"]);
    return {index:sourceIndex,result:{status:"applied",inserted:true,populated:true,
      uncertain:false,start_seconds:start,end_seconds:start+2,
      expected:{...expected,clips:[{kind:"video",track:0,clip_index:clipIndex,
        signature:nativeSignature}]}}};
  };
  return {panel,api,entries,make,calls,path,project,sequence,manifest,expected,receipt};
}
test("explicit separate native Project.open has active GUID/path readback and never saves",async()=>{
  const f=fixture();
  const result=await f.panel.executeCommand({action:"open_project",arguments:{path:f.path}});
  assert.equal(result.operation,"open");
  assert.equal(result.projectIdentityVerified,true);
  assert.equal(result.projectGuid,"project1");
  assert.equal(result.activeGuid,"project1");
  assert.equal(result.reopenVerified,false);
  assert.equal(f.calls.opens,1);
  assert.equal(f.calls.saves,0);
});
test("independent native caption post-open audit survives sorted index shifts without write",async()=>{
  const f=fixture();
  const approved=await f.panel.executeCommand({action:"open_project",arguments:{path:f.path}});
  assert.equal(approved.projectIdentityVerified,true);
  const older=f.make(12,"id0","First"),earlier=f.make(2,"id1","नमस्ते");
  f.entries.push(older);
  const proofOlder=f.receipt(0,0,older,12);
  f.entries.push(earlier);
  const proofEarlier=f.receipt(1,0,earlier,2);
  const inspection=await f.panel.executeCommand({action:"verify_caption_graphics",arguments:{
    _expected:f.expected,mapping:f.manifest,videoTrack:0,
    items:[{seconds:12,duration_seconds:2,fields:{caption_text:"First"}},
      {seconds:2,duration_seconds:2,fields:{caption_text:"नमस्ते"}}],
    receipts:[proofOlder,proofEarlier]
  }});
  assert.equal(inspection.native_current_session_caption_values_verified,true);
  assert.equal(inspection.verified_count,2);
  assert.equal(inspection.readOnly,true);
  assert.equal(inspection.project_file_saved_verified,false);
  assert.equal(inspection.cross_session_reopen_verified,false);
  assert.equal(f.calls.opens,1);
  assert.equal(f.calls.saves,0);
  assert.equal(f.calls.writes,0);
});
test("post-open readback rejects tampered original native caption style",async()=>{
  const f=fixture();
  await f.panel.executeCommand({action:"open_project",arguments:{path:f.path}});
  const item=f.make(4,"id0","Original");
  f.entries.push(item);
  const receipt=f.receipt(0,0,item,4);
  item.setText("Changed");
  await assert.rejects(f.panel.executeCommand({action:"verify_caption_graphics",arguments:{
    _expected:f.expected,mapping:f.manifest,videoTrack:0,
    items:[{seconds:4,duration_seconds:2,fields:{caption_text:"Original"}}],
    receipts:[receipt]
  }}),/readback mismatch|does not match/i);
  assert.equal(f.calls.writes,0);
});
test("failed explicit open does not create a false receipt or save/reopen success",async()=>{
  const f=fixture({refuseOpen:true});
  await assert.rejects(f.panel.executeCommand({action:"open_project",arguments:{path:f.path}}),/open returned no project/i);
  assert.equal(f.calls.opens,1);
  assert.equal(f.calls.saves,0);
  assert.equal(f.entries.length,0);
});
