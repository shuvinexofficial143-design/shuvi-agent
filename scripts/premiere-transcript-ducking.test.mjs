import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const rust=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
const dialogue=readFileSync(new URL('../src-tauri/src/premiere_dialogue.rs',import.meta.url),'utf8');
const ctx={module:{exports:{}}};vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../integrations/premiere-uxp/audio-plans.js',import.meta.url),'utf8'),ctx);
const plan=ctx.module.exports.buildAudioPlan;
const selector={component_match_name:'exact-audio',param_display_name:'exact-volume'};
const inspected={current:1,keyframesSupported:true,timeVarying:false};
test('transcript-derived regions produce executable typed keyframes with recovery',()=>{
 const result=plan({mode:'duck',duration_seconds:10,baseline:1,value_unit:'native',target_value:0.4,min:0,max:2,attack_seconds:0.2,release_seconds:0.5,regions:[{start:2,end:3},{start:6,end:7}]},selector,inspected);
 assert.equal(result.executionTool,'premiere_apply_audio_recipe');assert.ok(result.settings.some(s=>s.seconds===2&&s.value===0.4));assert.ok(result.settings.some(s=>s.seconds===3.5&&s.value===1));
});
test('unknown units require exact native target and declared bounds',()=>{
 assert.throws(()=>plan({mode:'duck',duration_seconds:10,baseline:1,value_unit:'native',reduction_db:6,attack_seconds:0.2,release_seconds:0.5,regions:[{start:2,end:3}]},selector,inspected),/known dB\/amplitude unit/);
 assert.throws(()=>plan({mode:'duck',duration_seconds:10,baseline:1,value_unit:'native',target_value:0.4,min:0,max:2,attack_seconds:0.2,release_seconds:0.5,regions:[{start:2,end:3}]},selector,{...inspected,timeVarying:true}),/unanimated/);
});
test('live transcript export, bounded normalization, exact audio expectation and checkpoint precede typed apply',()=>{
 for(const name of ['premiere_plan_transcript_ducking','premiere_apply_transcript_ducking'])assert.match(rust,new RegExp(`"${name}" =>`));
 assert.match(rust,/premiere_dialogue::regions\(segments,transcript_offset,music_start,request\.duration_seconds,merge_gap\)/);
 assert.match(rust,/plan\.get\("expected"\)!=Some/);assert.match(rust,/backup_premiere_project\(&premiere_bridge\)\.await\?/);
 assert.match(rust,/premiere_bridge\.request\("apply_audio_recipe"/);
 assert.match(dialogue,/relative_start<last\.end/);assert.match(dialogue,/fn refuses_overlaps_and_ungrounded_offsets/);
});
