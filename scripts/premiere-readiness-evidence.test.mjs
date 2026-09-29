import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(`src-tauri/src/${name}.rs`,'utf8');
test('acceptance plan tools all exist and plans cannot promote runtime evidence',()=>{
  const harness=read('premiere_acceptance_harness'),desktop=read('lib');
  const cases=harness.split('let actions:')[1].split('if actions.len()')[0];
  for(const match of cases.matchAll(/\("[^"]+","([^"]+)",(?:true|false)\)/g)) {
    assert.match(desktop, new RegExp(`"${match[1]}"(?:\\s*\\|\\s*"[^"]+")*\\s*=>`), `Unrouted acceptance tool: ${match[1]}`);
  }
  assert.match(harness,/"evidence_promoted":false/);
  assert.match(harness,/"runtime_verified":false/);
});
test('current readiness keeps independent verification gates and never treats declarations as run evidence',()=>{
  const acceptance=read('premiere_acceptance'),desktop=read('lib');
  const dimensions=acceptance.split('pub fn evidence_dimensions')[1].split('fn supported_evidence_pair')[0];
  for(const key of ['static_schema_tests','mock_tests','rust_unit_tests','frontend_tests','windows_runtime','uxp_bridge_pairing','native_mutation_acceptance','checkpoint_recovery','export_completion','cancellation']) {
    assert.ok(dimensions.includes(`"${key}":{"state":"not_verified"`),key);
  }
  assert.match(desktop,/"node_mock_verified_capabilities":\[\]/);
  assert.match(acceptance,/!supported_evidence_pair\(&e.capability,&e.action\)/);
});
test('export jobs reload under a shared lock after native await, retaining other jobs',()=>{
  const desktop=read('lib');
  const body=desktop.split('ToolAction::PremiereExportSequence { output,')[1].split('ToolAction::PremiereSaveProject')[0];
  const dispatch=body.indexOf('let result=premiere_bridge.request');
  const after=body.slice(dispatch);
  const lock=after.indexOf('state.premiere_export_jobs_io.lock()');
  assert.ok(lock>after.indexOf(')).await;'));
  assert.ok(after.indexOf('premiere_export_jobs::load(&jobs_path)?')>lock);
});
