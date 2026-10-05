import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const bridge=readFileSync(new URL("../src-tauri/src/premiere_bridge.rs",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const local=readFileSync(new URL("../src-tauri/src/media_encoder.rs",import.meta.url),"utf8");
const target=readFileSync(new URL("../src-tauri/src/premiere_target.rs",import.meta.url),"utf8");

test("Media Encoder controls stay on documented Premiere EncoderManager surfaces",()=>{
  for(const token of ["media_encoder_status","media_encoder_events","media_encoder_launch","media_encoder_start_batch","media_encoder_set_xmp",
    "media_encoder_inspect_preset","media_encoder_encode_file","media_encoder_encode_project_item"]){
    assert.match(bridge,new RegExp('"' + token + '"'));
    assert.match(rust,new RegExp('"' + token + '"'));
  }
  assert.match(main,/EncoderManager\.getManager/);
  assert.match(main,/isAMEInstalled/);
  assert.match(main,/launchEncoder/);
  assert.match(main,/startBatchEncode/);
  assert.match(main,/setEmbeddedXMPEnabled/);
  assert.match(main,/setSidecarXMPEnabled/);
  assert.match(main,/getExportFileExtension/);
  assert.match(main,/encodeFile/);
  assert.match(main,/encodeProjectItem/);
  assert.match(main,/Output extension does not match the inspected \.epr preset export extension/);
  assert.match(main,/outputExtensionVerified: Boolean\(presetExtension\)/);
});

test("Media Encoder event evidence is bounded and never promoted to exact Shuvi job correlation",()=>{
  for(const token of ["EVENT_RENDER_QUEUE","EVENT_RENDER_PROGRESS","EVENT_RENDER_COMPLETE","EVENT_RENDER_ERROR","EVENT_RENDER_CANCEL"]){
    assert.match(main,new RegExp(token));
  }
  assert.match(main,/mediaEncoderEvents\.length > 128/);
  assert.match(main,/correlatedToShuviExport: false/);
  assert.match(main,/observational_only_not_bound_to_shuvi_export_request/);
  assert.match(rust,/Events are not automatically correlated to a Shuvi export request/);
});

test("Media Encoder production claims remain fail closed",()=>{
  assert.match(main,/sourceRuntimeVerified: false/);
  assert.match(main,/productionReady: false/);
  assert.match(main,/future_adapter_public_beta_not_current_transport/);
  assert.match(main,/completionVerified: false/);
  assert.match(rust,/starting a batch is high risk/);
});


test("Media Encoder local preflight requires real preset/source paths and symbolic ranges",()=>{
  assert.match(local,/Media Encoder preset must use the \.epr extension/);
  assert.match(local,/must not be a symbolic link/);
  assert.match(local,/range=entire must not include in_seconds\/out_seconds/);
  assert.match(local,/"entire"=>Ok\(0\)/);
  assert.match(local,/"in_out"=>Ok\(1\)/);
  assert.match(local,/"work_area"=>Ok\(2\)/);
  assert.match(target,/media_encoder_encode_project_item/);
  assert.match(target,/media_encoder_encode_file/);
});

test("Media Encoder encode receipts keep job ownership conservative",()=>{
  assert.match(main,/single_new_queue_event_observed_unverified_external_writer_race/);
  assert.match(main,/eventCandidateCount/);
  assert.match(main,/nativeJobIdCandidate/);
  assert.match(main,/completionVerified: false/);
  assert.match(rust,/retry_automatically/);
  assert.match(rust,/Project-item encoding requires inspected project expectation/);
});
