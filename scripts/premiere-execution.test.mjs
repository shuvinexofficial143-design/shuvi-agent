import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const desktop=readFileSync('src-tauri/src/lib.rs','utf8');
const execution=readFileSync('src-tauri/src/premiere_execution.rs','utf8');
test('every cancellable batch captures a generation when preparing, and uses it when cancelling',()=>{
  for(const family of ['rebuild','assembly','finishing','graphics','media_prep','layering','delivery']) {
    assert.ok(desktop.includes(`generation: state.${family}_running.generation()?`));
    assert.ok(desktop.includes(`state.${family}_running.cancel(generation, &state.${family}_cancelled)?`));
    assert.ok(desktop.includes(`state.${family}_running.begin(&state.${family}_cancelled)?`));
    assert.ok(!desktop.includes(`state.${family}_cancelled.store(false`));
  }
  assert.match(execution,/!state.active \|\| state.generation != generation/);
  assert.match(execution,/checked_add\(1\)/);
});
test('finishing uncertainty follows actual dispatch and complete uses the requested count',()=>{
  const body=desktop.split('ToolAction::PremiereBatchFinish{targets} => {')[1].split('ToolAction::PremierePlanVideoRecipe')[0];
  assert.match(body,/dispatched = true;\s*client.request\("apply_video_recipe"/);
  assert.match(body,/uncertain = dispatched/);
  assert.doesNotMatch(body,/error.contains/);
  assert.match(body,/success:done==requested&&!cancelled&&!uncertain/);
  const checkpoint = body.indexOf('backup_premiere_project(&client).await?');
  const cancel = body.indexOf('if state.finishing_cancelled.load', checkpoint);
  assert.ok(checkpoint >= 0 && cancel > checkpoint && cancel < body.indexOf('dispatched = true'));
});
