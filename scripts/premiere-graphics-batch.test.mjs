import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = name => readFileSync(new URL('../integrations/premiere-uxp/' + name, import.meta.url), 'utf8');
function load(name, dependencies = {}) {
  const context = {module:{exports:{}}, require:n => dependencies[n]};
  vm.createContext(context); vm.runInContext(read(name), context);
  return context.module.exports;
}
const mogrt = load('mogrt-workflows.js');
const graphics = load('graphics-batch.js', {'./mogrt-workflows.js':mogrt});
const tick = seconds => ({seconds, ticks:String(Math.round(seconds * 1000))});
const mapping = () => ({schema_version:1,name:'doctor',template:{source:'path',path:'C:/templates/doctor.mogrt'},
  fields:[{role:'name',component_match_name:'native.graphics',param_display_name:'Exact field',primitive_type:'string'}]});

function fixture(options = {}) {
  const video = [], audio = [], inserted = [];
  let insertCalls = 0, transactions = 0;
  function makeClip(start, id, value = 'Original') {
    let end = start + 5;
    const param = {displayName:'Exact field',getStartValue:async () => ({value}),areKeyframesSupported:async () => true,
      isTimeVarying:async () => false,createKeyframe:async v => ({value:v}),
      createSetValueAction:k => () => {if (!options.ignoreWrite) value = k.value;}};
    const params = [param];
    const component = {getMatchName:async () => 'native.graphics',getDisplayName:async () => 'Localized graphic',
      getParamCount:async () => params.length,getParam:async i => params[i]};
    const components = [component];
    const item = {getName:async () => 'Graphic '+id,getMatchName:async () => 'opaque',getTrackIndex:async () => 0,
      getStartTime:async () => tick(start),getEndTime:async () => tick(end),getInPoint:async () => tick(0),getOutPoint:async () => tick(5),
      getProjectItem:async () => ({getId:async () => id}),getComponentChain:async () => ({getComponentCount:async () => components.length,getComponentAtIndex:async i => components[i]}),
      createSetEndAction:t => () => {if (!options.ignoreTrim) end=t.seconds;},
      param,params,components,read:() => value};
    return item;
  }
  const sequence = {guid:'sequence',getVideoTrackCount:async () => 1,getAudioTrackCount:async () => 1,
    getVideoTrack:async i => i===0?{getTrackItems:async () => video}:null,
    getAudioTrack:async i => i===0?{getTrackItems:async () => audio}:null};
  const project = {guid:'project',path:'C:/edit.prproj',getActiveSequence:async () => sequence,lockedAccess:fn => fn(),
    executeTransaction(fn) {transactions++;if(options.transactionFailure)throw Error('native transaction failed');const actions=[];fn({addAction:a=>actions.push(a)});actions.forEach(a=>a());return true;}};
  async function insert(...args) {
    insertCalls++;
    const start = args[args.length-3].seconds;
    const clip = makeClip(start,'created-'+insertCalls,options.nativeValue ?? 'Original');
    options.configure?.(clip,insertCalls);
    video.push(clip); inserted.push(clip);
    if (options.audio) audio.push(makeClip(start,'audio-'+insertCalls));
    if (options.changeExisting && video.length>1) video[0]=makeClip(1,'changed');
    if (options.switchSequence) sequence.guid='changed';
    if (options.throwAfterInsert) throw Error('lost native reply');
    if (options.emptyReceipt) return [];
    if (options.wrongReceipt) return [makeClip(start,'different')];
    return [clip];
  }
  const premiere = {Project:{getActiveProject:async () => project},ProjectItem:{cast:i=>i},
    Constants:{TrackItemType:{CLIP:1}},TickTime:{createWithSeconds:tick},
    SequenceEditor:{getEditor:() => ({insertMogrtFromPath:insert,insertMogrtFromLibrary:insert})}};
  const panel = {require:n => n==='premierepro'?premiere:n==='uxp'?{entrypoints:{setup(){}}}:n==='./mogrt-workflows.js'?mogrt:n==='./graphics-batch.js'?graphics:{}};
  vm.createContext(panel);vm.runInContext(read('main.js'),panel);
  const args = {mapping:mapping(),item:{seconds:5,fields:{name:'Dr. A'}},videoTrack:0,audioTrack:0,
    _expected:{project_guid:'project',project_path:'C:/edit.prproj',sequence_guid:'sequence',clips:[]}};
  return {panel,args,video,audio,inserted,makeClip,project,sequence,run:() => panel.executeCommand({action:'insert_mapped_graphic',arguments:args}),
    stats:() => ({insertCalls,transactions})};
}

for (const [kind,original,next] of [['string','Original','Dr. A'],['number',10,12],['boolean',true,false]]) {
  test('real native insertion, typed recipe and readback: '+kind,async () => {
    const f=fixture({nativeValue:original});f.args.mapping.fields[0].primitive_type=kind;f.args.item.fields.name=next;
    const result=await f.run();assert.equal(result.status,'applied',result.reason);assert.equal(result.populated,true);
    assert.equal(result.native_duration_seconds,5);assert.equal(result.duration_seconds,5);assert.equal(f.inserted[0].read(),next);
    assert.equal(result.expected.clips[0].signature.includes('created-1'),true);assert.deepEqual(f.stats(),{insertCalls:1,transactions:1});
  });
}
test('library title/price/CTA roles use the same native executor without inference',async () => {
  for(const role of ['title','chapter','cta','price','location','custom2']) {
    const f=fixture();f.args.mapping.template={source:'library',library_name:'Known',element_name:'Card'};
    f.args.mapping.fields[0].role=role;f.args.item.fields={[role]:'Explicit content'};
    assert.equal((await f.run()).status,'applied');assert.equal(f.inserted[0].read(),'Explicit content');
  }
});
test('many placements re-resolve sorted indexes and preserve existing unrelated clips',async () => {
  const f=fixture();const original=f.makeClip(400,'old');f.video.push(original);
  for(let n=0;n<32;n++) {f.args.item.seconds=n*10;f.args.item.fields.name='Name '+n;
    const result=await f.run();assert.equal(result.status,'applied',result.reason);assert.equal(result.expected.clips[0].clip_index,n);}
  assert.equal(f.video.length,33);assert.equal(original.read(),'Original');assert.equal(f.stats().insertCalls,32);
});
for (const mode of ['wrong type','missing selector','animated','no setter','complex','duplicate component','duplicate parameter']) {
  test('inserted '+mode+' fails without writing any fields',async () => {
    const f=fixture({configure:clip=>{
      if(mode==='wrong type')clip.param.getStartValue=async()=>({value:12});
      if(mode==='missing selector')clip.param.displayName='Different';
      if(mode==='animated')clip.param.isTimeVarying=async()=>true;
      if(mode==='no setter')clip.param.createSetValueAction=undefined;
      if(mode==='complex')clip.param.getStartValue=async()=>({value:{text:'Complex'}});
      if(mode==='duplicate component')clip.components.push(clip.components[0]);
      if(mode==='duplicate parameter')clip.params.push(clip.param);
    }});
    const result=await f.run();assert.equal(result.status,'failed');assert.equal(result.inserted,true);assert.equal(result.uncertain,false);
    assert.equal(result.populated,false);assert.equal(f.stats().transactions,0);assert.equal(f.video.length,1);
  });
}
test('one mismatched item does not corrupt successful earlier and later graphics',async () => {
  const f=fixture({configure:(clip,n)=>{if(n===2)clip.param.displayName='Wrong';}});const reports=[];
  for(let n=0;n<3;n++){f.args.item.seconds=n*10;reports.push(await f.run());}
  assert.deepEqual(reports.map(r=>r.status),['applied','failed','applied']);assert.equal(f.inserted[1].read(),'Original');
});
test('duration shortening delegates to typed trim and reports observed bounds',async () => {
  const f=fixture();f.args.item.duration_seconds=2;const r=await f.run();
  assert.equal(r.status,'applied',r.reason);assert.equal(r.trimmed,true);assert.equal(r.native_duration_seconds,5);
  assert.equal(r.duration_seconds,2);assert.equal(r.end_seconds,7);assert.equal(f.stats().transactions,2);
});
for(const mode of ['extend','audio','missing trim']) test('unsupported duration '+mode+' reports native duration honestly',async () => {
  const f=fixture({audio:mode==='audio',configure:c=>{if(mode==='missing trim')c.createSetEndAction=undefined;}});
  f.args.item.duration_seconds=mode==='extend'?8:2;const r=await f.run();assert.equal(r.status,'failed');assert.equal(r.trimmed,false);
  assert.equal(r.native_duration_seconds,5);assert.equal(f.stats().transactions,0);assert.equal(r.audio_items.length,mode==='audio'?1:0);
});
for(const mode of ['emptyReceipt','wrongReceipt','throwAfterInsert','switchSequence','ignoreWrite','ignoreTrim','transactionFailure']) {
  test(mode+' stops as uncertain with no blind retry',async () => {
    const f=fixture({[mode]:true});if(mode==='ignoreTrim')f.args.item.duration_seconds=2;
    if (mode === 'switchSequence') {
      await assert.rejects(f.run(), /sequence changed/);
      assert.equal(f.stats().insertCalls, 1);
      return;
    }
    const r=await f.run();assert.equal(r.status,'uncertain',r.reason);assert.equal(r.uncertain,true);assert.equal(r.stop_batch,true);
    assert.equal(f.stats().insertCalls,1);assert.equal(r.automatic_rollback,false);
  });
}
test('stale sequence and project are rejected before insertion',async () => {
  for(const changed of ['sequence','project']) {const f=fixture();f[changed].guid='new';await assert.rejects(f.run(),/changed/);assert.equal(f.stats().insertCalls,0);}
});
test('missing expectation, missing tracks and occupied destinations never insert',async () => {
  const f=fixture();delete f.args._expected;await assert.rejects(f.run(),/expectation/);assert.equal(f.stats().insertCalls,0);
  const g=fixture();g.args.videoTrack=1;await assert.rejects(g.run(),/existing/);assert.equal(g.stats().insertCalls,0);
  const h=fixture();h.video.push(h.makeClip(4,'existing'));await assert.rejects(h.run(),/occupied/);assert.equal(h.stats().insertCalls,0);
});
test('changed pre-existing clips are detected before population',async () => {
  const f=fixture({changeExisting:true});f.video.push(f.makeClip(50,'existing'));const r=await f.run();
  assert.equal(r.uncertain,true);assert.match(r.reason,/existing clips/);assert.equal(f.stats().transactions,0);
});
test('native duration overlapping a later clip stops with inserted receipt',async () => {
  const f=fixture();f.video.push(f.makeClip(8,'later'));const r=await f.run();assert.equal(r.uncertain,true);
  assert.equal(r.inserted,true);assert.match(r.reason,/overlaps/);assert.equal(f.stats().transactions,0);
});
test('no inferred roles, arbitrary fields, executable payloads or primitive coercion',() => {
  const m=mapping();assert.throws(()=>graphics.validateItem(m,{seconds:1,fields:{title:'Dr. A'}}),/Unknown/);
  assert.throws(()=>graphics.validateItem(m,{seconds:1,fields:{name:12}}),/type/);
  assert.throws(()=>graphics.validateMapping({...m,script:'alert(1)'}),/Unknown/);
  assert.throws(()=>graphics.validateItem(m,{seconds:1,fields:{name:'x'},code:'run'}),/Unknown/);
  assert.throws(()=>graphics.validateItem(m,{seconds:1,fields:{name:'x'.repeat(2049)}}),/type/);
  assert.throws(()=>graphics.validateItem(m,{seconds:1,fields:{name:{text:'x'}}}),/type/);
  assert.throws(()=>graphics.validateMapping({...m,fields:Array(17).fill(m.fields[0])}),/1–16/);
  assert.throws(()=>graphics.validateMapping({...m,template:{source:'path',path:'relative.mogrt'}}),/Absolute/);
});
