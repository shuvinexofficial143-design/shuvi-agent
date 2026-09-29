import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
function fixture() {
  let removals=0;
  const marker={getName:async()=> 'A',getType:async()=> 'Comment',getStart:async()=>({ticks:'1',seconds:1}),
    getDuration:async()=>({ticks:'0',seconds:0}),getComments:async()=>'',getColorIndex:async()=>0};
  const values=[marker], sequence={guid:'s'};
  const markers={getMarkers:async()=>values,createRemoveMarkerAction:()=>{removals++;return {};}};
  const project={guid:'p',path:'C:/a.prproj',lockedAccess:fn=>fn(),executeTransaction:fn=>{fn({addAction(){}});return true;}};
  const panel={require:()=>({entrypoints:{setup(){}}})};vm.createContext(panel);
  vm.runInContext(readFileSync('integrations/premiere-uxp/main.js','utf8'),panel);
  panel.getSequenceMarkers=async()=>({project,sequence,markers});
  return {panel,marker,values,get removals(){return removals;}};
}
test('marker deletion binds exact inspected marker attributes and native ticks',async()=>{
  const f=fixture();const row=(await f.panel.listMarkers()).markers[0];
  await assert.rejects(f.panel.removeMarker({markerIndex:0}),/inspect markers/);
  await f.panel.removeMarker({markerIndex:0,expectedSignature:row.targetSignature});
  assert.equal(f.removals,1);
  f.marker.getStart=async()=>({ticks:'2',seconds:2});
  await assert.rejects(f.panel.removeMarker({markerIndex:0,expectedSignature:row.targetSignature}),/changed/);
  assert.equal(f.removals,1);
});
test('indistinguishable markers and truncated inspection cannot authorize removal',async()=>{
  const f=fixture();const signature=(await f.panel.listMarkers()).markers[0].targetSignature;
  f.values.push(f.marker);
  await assert.rejects(f.panel.removeMarker({markerIndex:0,expectedSignature:signature}),/ambiguous/);
  while(f.values.length<1001) f.values.push(f.marker);
  const inspection=await f.panel.listMarkers();
  assert.equal(inspection.truncated,true);assert.equal(inspection.markers[0].targetSignature,null);
  await assert.rejects(f.panel.removeMarker({markerIndex:0,expectedSignature:signature}),/bound/);
  assert.equal(f.removals,0);
});
