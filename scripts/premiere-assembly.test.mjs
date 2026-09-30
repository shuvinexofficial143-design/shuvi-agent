import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const rust=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');const schema=readFileSync(new URL('../src-tauri/src/premiere_assembly.rs',import.meta.url),'utf8');const uxp=readFileSync(new URL('../integrations/premiere-uxp/main.js',import.meta.url),'utf8');const bridge=readFileSync(new URL('../src-tauri/src/premiere_bridge.rs',import.meta.url),'utf8');
test('shot list accepts v1/v2 with bounded explicit source ranges',()=>{for(const p of [/matches!\(self\.schema_version,1\|2\)/,/MAX_SHOTS: usize = 64/,/MAX_CHAPTERS: usize = 32/,/source range requires both valid source_in and source_out/,/matches!\(shot\.mode\.as_str\(\),"insert"\|"overwrite"\)/])assert.match(schema,p)});
test('native preflight checks exact items and existing tracks before insertion',()=>{assert.match(uxp,/async function inspectAssemblyItems/);assert.match(uxp,/findProjectItemById\(root,id\)/);assert.match(uxp,/asClipProjectItem\(item\)/);assert.match(bridge,/"inspect_assembly_items"/);assert.match(rust,/if !blocked\.is_empty\(\)\{return Err/);});
test('assembly uses bounded existing insert/overwrite and chapter tool, checkpoint, native post-inspection, cancellation',()=>{for(const n of ['premiere_plan_assembly','premiere_apply_assembly','premiere_cancel_assembly'])assert.match(rust,new RegExp(`"${n}" =>`));for(const p of [/backup_premiere_project\(&premiere_bridge\)\.await\?/,/request\(\s*"insert_project_item"/,/request\(\s*"add_marker"/,/assembly_cancelled\.load/,/request\(\s*"inspect_timeline"/,/uncertain=true/,/expected\.sequence_guid\.is_none\(\)/])assert.match(rust,p)});

test('assembly stops when project-item insertion is not an exact verified insert delta',()=>{
 const arm=rust.slice(rust.indexOf('ToolAction::PremiereAssembly{assembly,apply}'),rust.indexOf('ToolAction::PremiereFinishMediaBatch'));
 assert.match(arm,/verified_insert_delta/);
 assert.match(arm,/"status":if verified\{"verified"\}else\{"uncertain"\}/);
 assert.match(arm,/if !verified \{uncertain=true;break;\}/);
 assert.match(arm,/shot_results\.iter\(\)\.all\(\|row\|row\["status"\]=="verified"\)/);
 assert.match(arm,/music_results\.iter\(\)\.all\(\|row\|row\["status"\]=="verified"\)/);
});
