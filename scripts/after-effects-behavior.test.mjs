import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../integrations/after-effects-extendscript/shuvi-ae.jsx",import.meta.url),"utf8");
// These execute the source against a model of the documented host surface, not Adobe.
function renderHost(mode, markerOverrides = {}) {
  const context=vm.createContext({mode,markerOverrides});
  vm.runInContext(`
    var calls={render:0,stop:0},files={},$={global:{}};
    function File(path){this.fsName=path;this.path=path;}
    Object.defineProperties(File.prototype,{
      exists:{get:function(){return !!files[this.path];}},
      length:{get:function(){var f=files[this.path];return f?(f.raw?f.raw.length:f.length):0;}},
      modified:{get:function(){return new Date(2000);}}
    });
    File.prototype.open=function(){return this.exists;};
    File.prototype.read=function(){return files[this.path].raw;};File.prototype.close=function(){};
    var RQItemStatus={QUEUED:1,DONE:2,USER_STOPPED:3};
    var item={comp:{id:12},render:true,status:1,numOutputModules:1,onStatusChanged:null,
      outputModule:function(){return {file:new File("C:/out.mov")};}};
    var queue={numItems:1,rendering:false,item:function(){return item;},
      stopRendering:function(){calls.stop++;this.rendering=false;item.status=3;},
      render:function(){calls.render++;this.rendering=true;
        if(mode!=="complete"){writeMarker();}
        if(mode==="foreign_project")app.project={file:new File("C:/foreign.aep"),renderQueue:queue};
        if(mode==="foreign_item")item.comp={id:99};
        $.global[item.onStatusChanged]();
        if(this.rendering){this.rendering=false;item.status=2;files["C:/out.mov"]={length:100};}
      }};
    var app={project:{file:new File("C:/edit.aep"),revision:5,renderQueue:queue}};
    $.global.ShuviAECancelPath="C:/job.cancel";$.global.ShuviAERequestId="job";
    $.global.ShuviAEExpectedProjectFile="C:/edit.aep";$.global.ShuviAEExpectedProjectRevision=5;
    function writeMarker(){files["C:/job.cancel"]={raw:JSON.stringify(Object.assign({schema_version:1,request_id:"job",
      expected_project_file:"C:/edit.aep",expected_project_revision:5,requested_at_ms:123,
      scope:"render_queue_status_boundary_cooperative_stop"},markerOverrides))};}
    if(mode==="before")writeMarker();
    var request={schema_version:1,request_id:"job",action:"render_queue",expected_project_file:"C:/edit.aep",
      expected_project_revision:5,args:{items:[{queue_index:1,comp_id:12,output_file:"C:/out.mov"}]}};
  `,context);
  vm.runInContext(source,context);
  return {context,run:()=>JSON.parse(JSON.stringify(vm.runInContext("ShuviAE.dispatch(request)",context)))};
}
test("AE pre-start cancellation reads exact request, project and revision marker",()=>{
  for(const override of [{request_id:"another"},{expected_project_file:"C:/other.aep"},{expected_project_revision:6},{scope:"other"},{schema_version:2}]){
    const host=renderHost("before",override);
    assert.throws(host.run,/identity mismatch/);
    assert.equal(host.context.calls.render,0);assert.equal(host.context.calls.stop,0);
  }
  const host=renderHost("before"),result=host.run();
  assert.equal(result.verification_status,"verified_render_cancelled_before_start");
  assert.equal(result.render_stopped,false);assert.equal(result.render_started,false);
  assert.equal(result.retry_safe,false);assert.equal(host.context.calls.stop,0);
});
test("AE cooperative stop verifies stopped status and restores callback",()=>{
  const host=renderHost("during"),result=host.run();
  assert.equal(result.verification_status,"verified_render_cancelled");
  assert.equal(result.render_stopped,true);assert.equal(result.cancel_observed,true);
  assert.equal(host.context.calls.stop,1);assert.equal(host.context.item.onStatusChanged,null);
  assert.equal(result.retry_safe,false);
});
test("AE callback refuses foreign project or queue item ownership",()=>{
  for(const mode of ["foreign_project","foreign_item"]){
    const host=renderHost(mode),result=host.run();
    assert.equal(host.context.calls.stop,0);assert.equal(result.render_cancel_verified,false);
    assert.equal(result.render_completion_verified,false);assert.equal(result.outcome_uncertain,true);
    assert.match(result.cancellation_error,/ownership changed/);
  }
});
test("AE completed render remains completion when no cancellation is observed",()=>{
  const host=renderHost("complete"),result=host.run();
  assert.equal(result.render_completion_verified,true);assert.equal(result.render_cancel_verified,false);
  assert.equal(result.media_parse_verified,false);assert.equal(host.context.calls.stop,0);
});
