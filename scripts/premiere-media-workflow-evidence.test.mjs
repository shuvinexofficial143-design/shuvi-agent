import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

// Adobe UXP loads CommonJS .js; the root Node package is ESM. Evaluate the
// same helper as a CommonJS script without changing the Adobe package format.
const helperModule = {exports:{}};
runInNewContext(readFileSync(new URL("../integrations/premiere-uxp/media-workflow-evidence.js",import.meta.url),"utf8"),
  {module:helperModule,exports:helperModule.exports});
const evidence = helperModule.exports;

const main = readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url), "utf8");
const section = (start, end) => {
  const i = main.indexOf(start), j = main.indexOf(end, i);
  assert.ok(i >= 0 && j > i, "Premiere UXP function boundaries must exist");
  return main.slice(i, j);
};
const importSource = section("async function importMedia(argumentsValue)", "\nasync function importCaptionSource");
const sequenceSource = section("async function createSequenceFromMedia(argumentsValue)", "\nasync function saveProject");
const load = (source, name, deps) => new Function(...Object.keys(deps),
  '"use strict"; ' + source + '\nreturn ' + name + ';')(...Object.values(deps));

test("strict media input prevents silent omissions, path aliases, and relative imports", () => {
  assert.deepEqual(evidence.validatedMediaPaths(["C:\\video\\a.mp4", "/tmp/b.mov"], 50),
    ["C:\\video\\a.mp4", "/tmp/b.mov"]);
  for (const paths of [
    [], ["C:\\a.mp4", ""], ["C:\\a.mp4", 123],
    ["C:\\a.mp4", "c:/A.mp4"], ["../unsafe.mov"], ["C:\\a.mp4 "],
    ["C:\\a.mp4\n"], ["C:\\a.mp4", "C:/a.mp4"]
  ]) {
    assert.throws(() => evidence.validatedMediaPaths(paths, 50));
  }
  assert.throws(() => evidence.validatedMediaPaths(Array(51).fill("/movie.mov"), 50));
});

test("sequence evidence requires native media coverage, positive durations and temporal order", () => {
  const good = [
    {mediaId:"clipA",startSeconds:0,endSeconds:3},
    {mediaId:"clipA",startSeconds:0,endSeconds:3},
    {mediaId:"clipB",startSeconds:3,endSeconds:7}
  ];
  const check=(rows,complete=true)=>evidence.assessSequenceMediaEvidence(["clipA","clipB"],rows,complete);
  assert.equal(check(good).verified,true);
  assert.equal(check(good).temporalOrderVerified,true);
  assert.equal(check(good.slice(0,2)).verified,false);
  assert.equal(check(good,false).verified,false);
  assert.equal(check([...good,{mediaId:"other",startSeconds:8,endSeconds:9}]).verified,false);
  assert.equal(check([{mediaId:"clipA",startSeconds:4,endSeconds:5},
    {mediaId:"clipB",startSeconds:1,endSeconds:2}]).verified,false);
  assert.equal(check([{mediaId:"clipA",startSeconds:0,endSeconds:0},
    {mediaId:"clipB",startSeconds:3,endSeconds:7}]).verified,false);
  assert.equal(evidence.assessSequenceMediaEvidence(["clipA","clipA"],good,true).verified,false);
});

function importFixture(initial=[], incomplete=false, duplicate=false) {
  const media = new Set(initial);
  const imported = [];
  const project = {
    name:"Disposable Edit",
    getRootItem:async()=>({}),
    importFiles:async(paths)=>{
      imported.push([...paths]);
      for (const p of paths) media.add(p);
      return true;
    }
  };
  const importMedia = load(importSource,"importMedia",{
    validatedMediaPaths:evidence.validatedMediaPaths,
    requireProject:async()=>project,
    findClipItemsForPaths:async(_project,_root,paths)=>({
      clips:paths.filter(p=>media.has(p)).map(path=>({path})),
      missing:paths.filter(p=>!media.has(p)),
      duplicatePaths:duplicate?paths.filter(p=>media.has(p)):[],
      scanComplete:!incomplete,scannedItems:media.size
    })
  });
  return {importMedia,imported};
}

test("importMedia handler imports only missing media and verifies existing items",async()=>{
  const a="C:\\media\\a.mp4",b="C:\\media\\b.mp4";
  const existing=importFixture([a]);
  const result=await existing.importMedia({paths:[a,b]});
  assert.deepEqual(existing.imported,[[b]]);
  assert.equal(result.imported,1);
  assert.equal(result.alreadyPresent,1);
  assert.equal(result.verificationStatus,"verified_readback");
  const noOp=await existing.importMedia({paths:[a,b]});
  assert.equal(noOp.imported,0);
  assert.equal(noOp.retrySafe,true);
  assert.equal(existing.imported.length,1);
});

test("importMedia handler rejects incomplete/ambiguous inventories before mutation",async()=>{
  const a="C:\\media\\a.mp4",b="C:\\media\\b.mp4";
  for (const f of [importFixture([a],true),importFixture([a],false,true)]) {
    await assert.rejects(f.importMedia({paths:[a,b]}));
    assert.deepEqual(f.imported,[]);
  }
});

function sequenceFixture(timelineRows) {
  const a="C:\\media\\a.mp4",b="C:\\media\\b.mp4";
  const clips=[{id:"clipA"},{id:"clipB"}];
  const trackItems=timelineRows.map(([id,start,end])=>({
    getProjectItem:async()=>({id}),
    getStartTime:async()=>({seconds:start}),
    getEndTime:async()=>({seconds:end})
  }));
  const sequence={
    guid:"new-sequence",name:"Demo Edit",
    getVideoTrackCount:async()=>1,getAudioTrackCount:async()=>0,
    getVideoTrack:async()=>({getTrackItems:async()=>trackItems})
  };
  let created=0, active=null;
  const project={
    getRootItem:async()=>({}),
    getSequences:async()=>created?[sequence]:[],
    createSequenceFromMedia:async()=>{created++;return sequence;},
    setActiveSequence:async s=>{active=s;},
    getActiveSequence:async()=>active
  };
  const createSequenceFromMedia=load(sequenceSource,"createSequenceFromMedia",{
    validatedMediaPaths:evidence.validatedMediaPaths,
    assessSequenceMediaEvidence:evidence.assessSequenceMediaEvidence,
    requireProject:async()=>project,
    findClipItemsForPaths:async()=>({missing:[],duplicatePaths:[],scanComplete:true,clips}),
    projectItemId:async item=>item.id,
    plainGuid:value=>value,
    premiere:{Constants:{TrackItemType:{CLIP:"clip"}}}
  });
  return {createSequenceFromMedia,getCreated:()=>created,paths:[a,b]};
}

test("createSequenceFromMedia verifies requested source IDs on real track-shaped readback",async()=>{
  const f=sequenceFixture([["clipA",0,2],["clipB",2,4]]);
  const value=await f.createSequenceFromMedia({name:"Demo Edit",paths:f.paths});
  assert.equal(f.getCreated(),1);
  assert.equal(value.sequenceWasNew,true);
  assert.equal(value.activeSequenceVerified,true);
  assert.equal(value.timelineContentVerified,true);
  assert.equal(value.verificationStatus,"verified_readback");
});

test("new sequence GUID alone cannot certify missing or wrongly ordered timeline clips",async()=>{
  const empty=sequenceFixture([]);
  const value=await empty.createSequenceFromMedia({name:"Demo Edit",paths:empty.paths});
  assert.equal(value.sequenceWasNew,true);
  assert.equal(value.timelineContentVerified,false);
  assert.equal(value.verificationStatus,"accepted_unverified");
  assert.equal(value.retrySafe,false);
  const bad=sequenceFixture([["clipB",0,2],["clipA",2,4]]);
  const mismatch=await bad.createSequenceFromMedia({name:"Demo Edit",paths:bad.paths});
  assert.equal(mismatch.verificationStatus,"accepted_unverified");
  const duplicate=sequenceFixture([]);
  await assert.rejects(duplicate.createSequenceFromMedia({
    name:"Demo Edit",paths:[duplicate.paths[0],duplicate.paths[0]]
  }));
  assert.equal(duplicate.getCreated(),0);
});
