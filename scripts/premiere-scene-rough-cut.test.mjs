import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const rough=readFileSync(new URL("../src-tauri/src/premiere_scene_rough_cut.rs",import.meta.url),"utf8");
const assembly=readFileSync(new URL("../src-tauri/src/premiere_assembly.rs",import.meta.url),"utf8");
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("AG exposes a read-only typed rough-cut planner",()=>{
  assert.match(rust,/premiere_plan_scene_rough_cut/);
  assert.match(rust,/PremierePlanSceneRoughCut/);
  assert.match(rust,/premiere_scene_rough_cut::build_plan/);
  assert.match(rough,/"premiere_apply_assembly"/);
  assert.match(rough,/"requires_separate_approval":true/);
});

test("AG shot catalog and selection are bounded and explicit",()=>{
  assert.match(rough,/MAX_CATALOG: usize = 256/);
  assert.match(rough,/MAX_ASSEMBLY_SHOTS: usize = 64/);
  assert.match(rough,/selection: Vec<String>/);
  assert.match(rough,/"automatic_shot_selection":false/);
  assert.match(rough,/"random_selection":false/);
});

test("AG requires an explicit completely empty active destination",()=>{
  assert.match(rough,/explicit_empty_active_sequence/);
  assert.match(rough,/destination must be completely empty/);
  assert.match(rough,/must have no caption tracks/);
  assert.match(rough,/"verified_empty":true/);
});

test("AG reuses Y2 source-range assembly instead of another insert engine",()=>{
  assert.match(rough,/Assembly \{/);
  assert.match(rough,/source_in: Some\(shot\.source_start\)/);
  assert.match(rough,/source_out: Some\(shot\.source_end\)/);
  assert.match(rough,/"new_insert_engine":false/);
  assert.match(rough,/Y2 source-range subclip \+ insert\/overwrite/);
});

test("AG supports explicit video-only B-roll through the same source-range engine",()=>{
  assert.match(rough,/BrollPlacement/);
  assert.match(rough,/take_audio: false/);
  assert.match(rough,/role: Some\("b_roll"\.into\(\)\)/);
  assert.match(assembly,/take_audio:bool/);
  assert.match(rust,/"takeAudio":shot\.take_audio/);
});

test("AB now returns a normalized rough-cut-ready shot catalog",()=>{
  assert.match(uxp,/shotCatalog/);
  assert.match(uxp,/ready_for_rough_cut/);
  assert.match(uxp,/source_start/);
  assert.match(uxp,/source_end/);
  assert.match(uxp,/representative_seconds/);
});

test("visual description remains factual and never identifies or ranks people/shots",()=>{
  for(const field of ["person_visible","product_visible","framing","lighting","text_graphics_visible"]){
    assert.match(rough,new RegExp(field));
  }
  assert.match(rough,/"identify_people":false/);
  assert.match(rough,/"rank_shots":false/);
  assert.match(rough,/must_run_while_source_sequence_is_active/);
});

test("post-rough-cut review is bounded and opt-in",()=>{
  assert.match(rough,/MAX_REVIEW_TIMES: usize = 8/);
  assert.match(rough,/if request\.request_review/);
  assert.match(rough,/"run_after_apply":true/);
  assert.match(rough,/"tool":"premiere_review_frames"/);
});
