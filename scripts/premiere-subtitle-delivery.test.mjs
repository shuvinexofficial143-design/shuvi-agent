import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const main=readFileSync(new URL('../integrations/premiere-uxp/main.js',import.meta.url),'utf8');
const caption=readFileSync(new URL('../integrations/premiere-uxp/caption-workflows.js',import.meta.url),'utf8');
const rust=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
const subtitles=readFileSync(new URL('../src-tauri/src/premiere_subtitles.rs',import.meta.url),'utf8');
const ctx={module:{exports:{}}};vm.createContext(ctx);vm.runInContext(caption,ctx);
const adapter=ctx.module.exports.adaptTranscriptTiming;
function exporter(value) {
  const start=main.indexOf('async function exportTranscript(argumentsValue)');
  const end=main.indexOf('async function listTranscriptionLanguages()',start);
  assert.ok(start>0&&end>start);
  const context={premiere:{Transcript:{exportToJSON:async()=>JSON.stringify(value)}},requireClipProjectItemById:async()=>({clip:{}}),adaptTranscriptTiming:adapter};
  vm.createContext(context);vm.runInContext(main.slice(start,end),context);
  return context.exportTranscript;
}
test('transcript delivery returns complete explicitly timed cues, without a JSON preview payload',async()=>{
  const segments=Array.from({length:129},(_,i)=>({start:i*2,end:i*2+1,text:`Line ${i}`}));
  const result=await exporter({segments})({itemId:'exact-id',deliverSrt:true});
  assert.equal(result.captions.segments.length,129);
  assert.equal(result.captions.segmentsTruncated,false);
  assert.equal(result.transcriptJson,undefined);
  const preview=await exporter({segments})({itemId:'exact-id'});
  assert.equal(preview.captions.segments.length,128);
  assert.equal(preview.captions.segmentsTruncated,true);
});
test('delivery refuses excessive and unrecognized transcript instead of writing partial cues',async()=>{
  const segments=Array.from({length:257},(_,i)=>({start:i*2,end:i*2+1,text:'X'}));
  await assert.rejects(exporter({segments})({itemId:'x',deliverSrt:true}),/256 cue/);
  const unknown=await exporter({words:[{text:'Not timed'}]})({itemId:'x',deliverSrt:true});
  assert.equal(unknown.captions.supported,false);
});
test('SRT delivery tools have permission, typed actions, path and overwrite guards',()=>{
  for(const name of ['premiere_write_srt','premiere_transcript_to_srt']) assert.match(rust,new RegExp(`"${name}" =>`));
  assert.match(rust,/ToolAction::PremiereWriteSrt\{output,overwrite,cues\}/);
  assert.match(rust,/ToolAction::PremiereTranscriptToSrt\{item_id,output,overwrite\}/);
  assert.match(subtitles,/create_new\(!overwrite\)/);
  assert.match(subtitles,/symlink_metadata/);
  assert.match(subtitles,/fn write_safe_srt\(/);
  assert.match(subtitles,/fn rejects_bad_timing_and_path\(/);
});
test('graphics population requires exact inspected selectors, expectation, checkpoint, and rejects skipped fields',()=>{
  assert.match(rust,/"premiere_populate_mogrt" => \{/);
  assert.match(rust,/expected\.clips\.len\(\)!=1/);
  assert.match(rust,/plan\.get\("expected"\)!=Some/);
  assert.match(rust,/settings\.len\(\)!=request\.fields\.len\(\)/);
  assert.match(rust,/backup_premiere_project\(&premiere_bridge\)\.await\?/);
  assert.match(rust,/premiere_bridge\.request\("apply_video_recipe"/);
});
