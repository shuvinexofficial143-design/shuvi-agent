import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read = n => readFileSync(new URL('../integrations/premiere-uxp/'+n,import.meta.url),'utf8');
const module = {exports:{}}; vm.runInNewContext(read('transcript-rebuild.js'),{module});
const rebuild = module.exports;
const plain = v => JSON.parse(JSON.stringify(v));
const request = () => ({schema_version:1,item_id:'media',source:{track:0,clip_index:0},transcript_source_offset:0,
  removals:[{start:10,end:15}],destination:{mode:'explicit_empty_target_sequence',sequence_guid:'dest',video_track:0,audio_track:0},take_video:true,take_audio:false,gap_seconds:0});
const observed = () => ({source:{item_id:'media',sequence_guid:'source',start:100,end:160,input:0,output:60,speed:1,reverse:false,signature:'exact'},
  source_supported:true,destination:{sequence_guid:'dest',video_tracks:1,audio_tracks:1,caption_tracks:0,rows:[]},
  captions:{supported:true,segmentsTruncated:false,segments:[{start:0,end:10,text:'first'},{start:10,end:15,text:'remove'},{start:15,end:60,text:'last'}]}});
const plan = (r=request(),o=observed()) => plain(rebuild.buildPlan(r,o));

test('one interior removal yields exact source, sequence and gapless destination ranges',()=>{
  const p=plan(); assert.equal(p.supported,true);
  assert.deepEqual(p.keep_ranges,[{source_range:[0,10],sequence_range:[100,110],destination_range:[0,10]}, {source_range:[15,60],sequence_range:[115,160],destination_range:[10,55]}]);
  assert.equal(p.duration_before,60);assert.equal(p.duration_after,55);
});
test('multiple interior cuts and explicit gaps',()=>{
  const r=request();r.removals.push({start:30,end:35});r.gap_seconds=1;
  const p=plan(r);assert.deepEqual(p.keep_ranges.map(k=>k.source_range),[[0,10],[15,30],[35,60]]);
  assert.deepEqual(p.keep_ranges.map(k=>k.destination_range),[[0,10],[11,26],[27,52]]);
});
for(const [name,removes,expected] of [
  ['adjacent',[{start:10,end:15},{start:15,end:20}],[[10,20]]],
  ['overlap',[{start:10,end:17},{start:15,end:20}],[[10,20]]],
  ['first',[{segment_id:'seg-0001'}],[[0,10]]],
  ['last',[{segment_id:'seg-0003'}],[[15,60]]],
  ['all',[{start:0,end:60}],[[0,60]]]]) test(`${name} removals`,()=>{
    const r=request();r.removals=removes;const p=plan(r);assert.deepEqual(p.remove_ranges,expected);
    if(name==='all'){assert.deepEqual(p.keep_ranges,[]);assert.equal(p.duration_after,0);}
  });
test('source offset and nonzero in-point never assume sequence equals source',()=>{
  const r=request(),o=observed();r.transcript_source_offset=20;o.source.input=20;o.source.output=80;
  const p=plan(r,o);assert.deepEqual(p.remove_ranges,[[30,35]]);assert.deepEqual(p.keep_ranges[1].sequence_range,[115,160]);
});
for(const [key,value] of [['speed',2],['reverse',true],['input',NaN],['output',61],['item_id','wrong']]) test(`ambiguous mapping: ${key}`,()=>{
  const o=observed();o.source[key]=value;assert.equal(plan(request(),o).supported,false);
});
test('offline/multicam/sequence/merged or unavailable subclip support is refused',()=>{
  const o=observed();o.source_supported=false;assert.equal(plan(request(),o).supported,false);
});
test('destination must differ, be empty and have exact tracks with no captions',()=>{
  for(const change of [d=>d.rows.push({}),d=>d.caption_tracks=1,d=>d.video_tracks=0,d=>d.sequence_guid='source']){
    const o=observed();change(o.destination);assert.equal(plan(request(),o).supported,false);
  }
});
test('malformed timing, unknown IDs and mixed ID/range requests are rejected',()=>{
  for(const removal of [{segment_id:'seg-0999'},{start:0,end:61},{segment_id:'seg-0001',start:0,end:2},{start:5,end:4}]){
    const r=request();r.removals=[removal];assert.throws(()=>plan(r));
  }
  const o=observed();o.captions.segmentsTruncated=true;assert.throws(()=>plan(request(),o));
  o.captions.segmentsTruncated=false;o.captions.segments[1].start=9;assert.throws(()=>plan(request(),o));
});
test('fragmentation and input bounds are enforced',()=>{
  const r=request(),o=observed();o.source.end=400;o.source.output=300;
  r.removals=Array.from({length:128},(_,i)=>({start:1+i*2,end:2+i*2}));
  assert.throws(()=>plan(r,o),/128 keep/);r.removals.push({start:290,end:291});assert.throws(()=>plan(r,o),/bounded/);
});
test('snapshot is exact, bounded for Unicode, and changes with source or transcript',()=>{
  const o=observed(),before=plan().plan_snapshot;o.captions.segments[0].text='changed';assert.notEqual(plan(request(),o).plan_snapshot,before);
  o.captions.segments[0].text='🎬'.repeat(4000);o.captions.segments[1].text='🎬'.repeat(4000);o.captions.segments[2].text='🎬'.repeat(4000);
  assert.throws(()=>plan(request(),o),/snapshot exceeds/);
});

function fakeApi(options={}) {
  const o=observed(),calls=[];let serial=0;
  const api={inspect:async()=>plain(o),subclip:async args=>{calls.push(['subclip',args]);
      if(options.correlation===false)return {correlationVerified:false};
      return {correlationVerified:true,boundarySemanticsVerified:options.bounds!==false,
        sourceBoundsVerified:options.bounds!==false,mediaSelectionVerified:options.media!==false,
        createdItemId:'sub-'+(++serial)};},
    insert:async(args,guid)=>{calls.push(['insert',args,guid]);if(options.fail)throw Error('lost native reply');
      const r=options.request||request(),p=plan(r),piece=p.keep_ranges[serial-1];
      for(const kind of ['video',...(r.take_audio?['audio']:[])]) o.destination.rows.push({kind,track:0,item_id:args.itemId,start:piece.destination_range[0],end:piece.destination_range[1]});
      if(options.ambiguous)o.destination.rows.push({...o.destination.rows[0]});
      return {edited:true};}};
  return {o,calls,workflow:rebuild.createWorkflow(api)};
}
test('read-only plan creates nothing and stale begin dispatches nothing',async()=>{
  const f=fakeApi(),r=request(),p=await f.workflow.plan(r);assert.equal(f.calls.length,0);f.o.source.signature='changed';
  await assert.rejects(()=>f.workflow.begin(r,p.plan_snapshot),/changed/);assert.equal(f.calls.length,0);
});
for(const audio of [false,true])test(`workflow creates hard bounded keep pieces with explicit audio=${audio}`,async()=>{
  const r=request();r.take_audio=audio;const f=fakeApi({request:r}),p=await f.workflow.plan(r),b=await f.workflow.begin(r,p.plan_snapshot);
  const source=JSON.stringify(f.o.source);
  for(let i=0;i<b.operation_count;i++){const step=await f.workflow.step(b.id,i);assert.equal(step.status,'applied',step.error);}
  assert.equal(JSON.stringify(f.o.source),source);assert.equal(f.o.destination.rows.length,audio?4:2);
  const args=f.calls[0][1];assert.equal(args.hardBoundaries,true);assert.equal(args.takeVideo,true);assert.equal(args.takeAudio,audio);
  assert.equal(f.calls[1][2],'dest');assert.equal(f.workflow.release(b.id).released,true);
});
test('changed destination after subclip stops before insertion without retry',async()=>{
  const f=fakeApi(),r=request(),p=await f.workflow.plan(r),b=await f.workflow.begin(r,p.plan_snapshot);
  await f.workflow.step(b.id,0);f.o.destination.rows.push({item_id:'user-added'});
  const result=await f.workflow.step(b.id,1);assert.equal(result.status,'failed');assert.equal(result.uncertain,false);assert.equal(f.calls.length,1);
  await assert.rejects(()=>f.workflow.step(b.id,1),/already attempted/);
});
for(const option of [{correlation:false},{bounds:false},{media:false},{fail:true},{ambiguous:true}])test(`partial/uncertain stop ${JSON.stringify(option)}`,async()=>{
  const f=fakeApi(option),r=request(),p=await f.workflow.plan(r),b=await f.workflow.begin(r,p.plan_snapshot);
  let result=await f.workflow.step(b.id,0);if(result.status==='applied')result=await f.workflow.step(b.id,1);
  assert.equal(result.status,'failed');assert.equal(result.uncertain,true);await assert.rejects(()=>f.workflow.step(b.id,2));
});
test('duplicate cursor cannot replay a mutation and release invalidates ID',async()=>{
  const f=fakeApi(),r=request(),p=await f.workflow.plan(r),b=await f.workflow.begin(r,p.plan_snapshot);
  await f.workflow.step(b.id,0);await assert.rejects(()=>f.workflow.step(b.id,0));
  assert.equal(f.calls.length,1);f.workflow.release(b.id);await assert.rejects(()=>f.workflow.step(b.id,1));
});

// Run the actual panel adapter, native correlation, transactions, and shared insertion primitive.
function nativeFixture(options={}) {
  const items=[],video=[],audio=[],transactions=[];
  const tick=n=>({seconds:n,ticks:String(n*1000)});
  const media=(id,name,start=0,end=60,flags={takeVideo:true,takeAudio:true})=>({id,name,start,end,flags,getId:async()=>id,
    isOffline:async()=>false,isSequence:async()=>false,isMergedClip:async()=>false,isMulticamClip:async()=>false,
    createSubClipAction:(name,a,b,hard,flags)=>()=>{assert.equal(hard,true);items.push(media('created-'+items.length,name,a.seconds,b.seconds,flags));if(options.ambiguous)items.push(media('duplicate',name,a.seconds,b.seconds,flags));}});
  const master=media('media','Original');items.push(master);
  const clip=(m,start,input=0,output=m.end-m.start)=>({getName:async()=>m.name,getStartTime:async()=>tick(start),getEndTime:async()=>tick(start+output-input),getInPoint:async()=>tick(input),getOutPoint:async()=>tick(output),getProjectItem:async()=>m,getSpeed:async()=>1,isSpeedReversed:async()=>false});
  const original=clip(master,100),source={guid:'source',getVideoTrackCount:async()=>1,getAudioTrackCount:async()=>1,getCaptionTrackCount:async()=>0,
    getVideoTrack:async()=>({getTrackItems:async()=>[original]}),getAudioTrack:async()=>({getTrackItems:async()=>[]})};
  const dest={guid:'dest',getVideoTrackCount:async()=>1,getAudioTrackCount:async()=>1,getCaptionTrackCount:async()=>0,
    getVideoTrack:async()=>({getTrackItems:async()=>video}),getAudioTrack:async()=>({getTrackItems:async()=>audio})};
  const root={getItems:async()=>items,getId:async()=>'root'};
  const project={guid:'project',path:'C:/test.prproj',getActiveSequence:async()=>source,getSequences:async()=>[source,dest],getRootItem:async()=>root,
    lockedAccess:fn=>fn(),executeTransaction:(fn,label)=>{const actions=[];fn({addAction:a=>actions.push(a)});actions.forEach(a=>a());transactions.push(label);return true;}};
  const native={Project:{getActiveProject:async()=>project},ProjectItem:{cast:i=>i},ClipProjectItem:{cast:i=>{if(!i.id)throw Error('not clip');return i;}},FolderItem:{cast:i=>{if(!i.getItems)throw Error('not folder');return i;}},TickTime:{createWithSeconds:tick},Constants:{TrackItemType:{CLIP:1}},
    SequenceEditor:{getEditor:sequence=>({createOverwriteItemAction:(m,time)=>()=>{assert.equal(sequence,dest);video.push(clip(m,time.seconds));if(m.flags.takeAudio)audio.push(clip(m,time.seconds));}})}};
  const panel={document:{getElementById:()=>null},require:name=>name==='premierepro'?native:name==='uxp'?{entrypoints:{setup(){}}}:name==='./transcript-rebuild.js'?rebuild:{}};
  vm.createContext(panel);vm.runInContext(read('main.js'),panel);
  // Transcript schema adaptation has its own tests; this fixture supplies its recognized native result.
  panel.exportTranscript=async()=>({captions:observed().captions});
  return {panel,video,audio,items,transactions,source,original};
}
for(const take_audio of [false,true])test(`actual panel subclip correlation and insertion preserve source; audio=${take_audio}`,async()=>{
  const f=nativeFixture(),r=request();r.take_audio=take_audio;
  const send=(action,args)=>f.panel.executeCommand({action,arguments:args});
  const p=await send('plan_transcript_rebuild',{request:r});assert.equal(p.supported,true);assert.equal(f.transactions.length,0);
  const b=await send('begin_transcript_rebuild',{request:r,plan_snapshot:p.plan_snapshot,_expected:p.expected});
  for(let index=0;index<b.operation_count;index++){
    const reply=await send('step_transcript_rebuild',{id:b.id,index,_expected:p.expected});assert.equal(reply.status,'applied',reply.error);
  }
  assert.equal(f.video.length,2);assert.equal(f.audio.length,take_audio?2:0);assert.equal(f.items.length,3);assert.equal(f.transactions.length,4);
  assert.equal((await f.original.getStartTime()).seconds,100);assert.equal((await f.original.getEndTime()).seconds,160);
  assert.equal((await f.video[1].getStartTime()).seconds,10);assert.equal((await f.video[1].getEndTime()).seconds,55);
});
test('actual ambiguous native subclip correlation never inserts',async()=>{
  const f=nativeFixture({ambiguous:true}),r=request();const p=await f.panel.getRebuildWorkflow().plan(r),b=await f.panel.getRebuildWorkflow().begin(r,p.plan_snapshot);
  const out=await f.panel.getRebuildWorkflow().step(b.id,0);assert.equal(out.uncertain,true);assert.equal(f.video.length,0);
});
