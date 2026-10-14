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
  assert.match(uxp,/verificationStatus:!beforeGuids\.has\(guid\) && matches\.length === 1 \? "verified_readback" : "accepted_unverified"/);
  assert.match(rust,/Sequence preset path must be an existing absolute file/);
  const start=rust.lastIndexOf("ToolAction::PremiereCreateSequenceFromPreset");
  const end=rust.indexOf("\n        ToolAction::PremiereGetWorkArea",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/verified_readback/);
  assert.match(arm,/success:verified/);
  assert.match(arm,/"post_state_verified":verified/);
  assert.match(arm,/"retry_safe":false/);
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

test("media import uses bounded complete path correlation and refuses duplicate-prone fallback",()=>{
  const importMedia=uxp.slice(uxp.indexOf("async function importMedia"),uxp.indexOf("function normalizeMediaPath"));
  assert.match(importMedia,/findClipItemsForPaths/);
  assert.match(importMedia,/observed\.scanComplete/);
  assert.match(importMedia,/verificationStatus: verified \? "verified_readback" : "accepted_unverified"/);

  const finder=uxp.slice(uxp.indexOf("async function collectClipMedia"),uxp.indexOf("async function createSequenceFromMedia"));
  assert.match(finder,/budget = \{remaining: 1000, complete: true\}/);
  assert.match(finder,/budget\.complete = false/);
  assert.match(finder,/scanComplete: budget\.complete/);

  const resolve=uxp.slice(uxp.indexOf("async function resolveOneClip"),uxp.indexOf("async function insertMedia"));
  assert.match(resolve,/refusing a duplicate-prone import/);

  const sequence=uxp.slice(uxp.indexOf("async function createSequenceFromMedia"),uxp.indexOf("async function saveProject"));
  assert.match(sequence,/cannot safely import missing media/);
});

test("desktop import succeeds only after exact media path readback",()=>{
  const start=rust.lastIndexOf("ToolAction::PremiereImportMedia");
  const end=rust.indexOf("\n        ToolAction::PremiereCreateSequenceFromMedia",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/verified_readback/);
  assert.match(arm,/success: verified/);
  assert.match(arm,/retry_safe/);
});

test("sequence-from-media requires a new stable GUID and active-sequence readback",()=>{
  const sequence=uxp.slice(uxp.indexOf("async function createSequenceFromMedia"),uxp.indexOf("async function saveProject"));
  assert.match(sequence,/beforeGuids/);
  assert.match(sequence,/matching\.length === 1/);
  assert.match(sequence,/activeSequenceVerified/);
  assert.match(sequence,/verificationStatus: verified \? "verified_readback" : "accepted_unverified"/);

  const start=rust.lastIndexOf("ToolAction::PremiereCreateSequenceFromMedia");
  const end=rust.indexOf("\n        ToolAction::PremiereCreateSubsequence",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/verified_readback/);
  assert.match(arm,/success: verified/);
});

test("subclip success requires new identity plus source-bound and media-selection readback",()=>{
  const subclip=uxp.slice(uxp.indexOf("async function createSubclip"),uxp.indexOf("async function transcribeItem"));
  assert.match(subclip,/correlationVerified/);
  assert.match(subclip,/sourceReadback=await readSourceInOut\(createdClip\)/);
  assert.match(subclip,/sourceBoundsVerified/);
  assert.match(subclip,/mediaSelectionVerified/);
  assert.match(subclip,/boundarySemanticsVerified=correlationVerified&&sourceBoundsVerified&&mediaSelectionVerified/);
  assert.match(subclip,/hardBoundaryModeVerified:false/);
  assert.match(subclip,/verified_creation_identity/);
  assert.match(subclip,/retrySafe: false/);

  const start=rust.lastIndexOf("ToolAction::PremiereCreateSubclip");
  const end=rust.indexOf("\n        ToolAction::PremiereTranscribeItem",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/bounds_verified/);
  assert.match(arm,/media_verified/);
  assert.match(arm,/&&bounds_verified&&media_verified/);
  assert.match(arm,/"hard_boundary_mode_verified":false/);
  assert.match(arm,/success: verified/);
});


test("single media preparation succeeds only after exact supported-field readback",()=>{
  const start=rust.lastIndexOf("ToolAction::PremierePrepareMediaItem");
  const end=rust.indexOf("\n        ToolAction::PremiereCancelMediaPrep",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/verificationStatus/);
  assert.match(arm,/Some\("verified_readback"\)/);
  assert.match(arm,/success:verified/);
  assert.match(arm,/"uncertain":!verified/);
  assert.match(arm,/"retry_safe":false/);
});

test("media preparation batch stops after accepted-unverified state or any dispatched error",()=>{
  const start=rust.lastIndexOf("ToolAction::PremierePrepareMediaBatch");
  const end=rust.indexOf("\n        ToolAction::PremiereCreateSequenceFromPreset",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/Some\("verified_readback"\)/);
  assert.match(arm,/"accepted_unverified"/);
  assert.match(arm,/"post_state_verified":verified/);
  assert.match(arm,/if !verified \{uncertain=true;break;\}/);
  assert.match(arm,/uncertain=true;/);
  assert.match(arm,/"status":"uncertain"/);
});
