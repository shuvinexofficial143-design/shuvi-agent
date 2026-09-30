import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const prep=readFileSync(new URL("../src-tauri/src/premiere_media_prep.rs",import.meta.url),"utf8");
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("AD exposes media interpretation, batch prep, preset sequence and work area tools",()=>{
  for(const name of [
    "premiere_inspect_media_interpretation","premiere_prepare_media_item","premiere_prepare_media_batch",
    "premiere_cancel_media_prep","premiere_create_sequence_from_preset","premiere_get_work_area","premiere_set_work_area"
  ]) assert.match(rust,new RegExp(name));
});

test("AD uses stable ClipProjectItem interpretation APIs",()=>{
  assert.match(uxp,/getFootageInterpretation/);
  assert.match(uxp,/createSetOverrideFrameRateAction/);
  assert.match(uxp,/createSetOverridePixelAspectRatioAction/);
  assert.match(uxp,/createSetScaleToFrameSizeAction/);
  assert.match(uxp,/createSetInputLUTIDAction/);
  assert.match(uxp,/getEmbeddedLUTID/);
  assert.match(uxp,/getInputLUTID/);
});

test("frame rate override is bounded and explicitly not timeline speed",()=>{
  assert.match(prep,/rate < 1\.0 \|\| rate > 1000\.0/);
  assert.match(rust,/"timeline_speed_changed":false/);
  assert.match(rust,/Frame-rate override is footage interpretation, not timeline speed\/time remapping/);
});

test("media preparation guards exact item and optional inspected media path",()=>{
  assert.match(prep,/expected_media_path/);
  assert.match(uxp,/Media path changed since inspection/);
  assert.match(uxp,/Offline media cannot be prepared safely/);
});

test("batch prep is bounded unique cancellable and checkpointed",()=>{
  assert.match(prep,/MAX_ITEMS: usize = 64/);
  assert.match(prep,/cannot mutate the same project item twice/);
  assert.match(rust,/media_prep_cancelled/);
  const arm=rust.slice(rust.indexOf("ToolAction::PremierePrepareMediaBatch"));
  assert.match(arm,/backup_premiere_project\(&premiere_bridge\)\.await\?/);
  assert.match(arm,/if state\.media_prep_cancelled\.load/);
});

test("scale-to-frame remains accepted unverified without a readback getter",()=>{
  assert.match(uxp,/Stable reviewed ClipProjectItem API exposes the action but no dedicated scale-to-frame readback getter/);
  assert.match(uxp,/verificationStatus: verified \? "verified_readback" : "accepted_unverified"/);
});

test("sequence preset creation uses stable 26.3 API and verifies new sequence identity",()=>{
  assert.match(uxp,/createSequenceWithPresetPath/);
  assert.match(uxp,/Sequence preset creation requires Premiere 26\.3\+/);
  assert.match(uxp,/sequenceWasNew/);
  assert.match(rust,/Sequence preset path must be an existing absolute file/);
});

test("work area uses stable 26.5 WorkAreaUtils and readback",()=>{
  assert.match(uxp,/WorkAreaUtils/);
  assert.match(uxp,/getWorkAreaInPoint/);
  assert.match(uxp,/getWorkAreaOutPoint/);
  assert.match(uxp,/setWorkAreaInOutPoints/);
  assert.match(uxp,/WorkAreaUtils\.setWorkAreaInOutPoints requires Premiere 26\.5\+/);
  assert.match(rust,/Work-area update requires exact project\/sequence expectation/);
});

test("pixel aspect ratio validates positive numerator denominator",()=>{
  assert.match(prep,/numerator <= 0\.0 \|\| self\.denominator <= 0\.0/);
  assert.match(uxp,/Pixel aspect numerator\/denominator must be finite positive values/);
});

test("AD mutation never advertises retry safety",()=>{
  assert.match(uxp,/retrySafe:false/);
  assert.match(rust,/"retry_safe":false/);
});

test("relink and proxy attachment require exact native path readback",()=>{
  const relink=uxp.slice(uxp.indexOf("async function relinkMedia"),uxp.indexOf("async function attachProxy"));
  assert.match(relink,/observedPath/);
  assert.match(relink,/normalizeMediaPath\(observedPath\) === normalizeMediaPath\(newPath\)/);
  assert.match(relink,/verificationStatus: verified \? "verified_readback" : "accepted_unverified"/);

  const proxy=uxp.slice(uxp.indexOf("async function attachProxy"),uxp.indexOf("function summarizeInsertedTrackItems"));
  assert.match(proxy,/observedHasProxy === true/);
  assert.match(proxy,/normalizeMediaPath\(observedProxyPath\) === normalizeMediaPath\(proxyPath\)/);
  assert.match(proxy,/retrySafe: false/);
});

test("single and batch media relink/proxy callers stop on unverified readback",()=>{
  for(const name of ["PremiereRelinkMedia","PremiereAttachProxy"]){
    const start=rust.lastIndexOf("ToolAction::"+name);
    const end=rust.indexOf("\n        ToolAction::Premiere",start+10);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_readback/);
    assert.match(arm,/success: verified/);
  }
  for(const [name,next] of [["PremiereBatchRelink","PremiereBatchAttachProxy"],["PremiereBatchAttachProxy","PremiereImportMedia"]]){
    const start=rust.lastIndexOf("ToolAction::"+name);
    const end=rust.indexOf("\n        ToolAction::"+next,start+10);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_readback/);
    assert.match(arm,/if !verified/);
    assert.match(arm,/uncertain":!verified/);
  }
});
