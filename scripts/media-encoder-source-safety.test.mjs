import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const bridge=readFileSync(new URL("../src-tauri/src/premiere_bridge.rs",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("Media Encoder controls stay on documented Premiere EncoderManager surfaces",()=>{
  for(const token of ["media_encoder_status","media_encoder_events","media_encoder_launch","media_encoder_start_batch","media_encoder_set_xmp"]){
    assert.match(bridge,new RegExp('"' + token + '"'));
    assert.match(rust,new RegExp('"' + token + '"'));
  }
  assert.match(main,/EncoderManager\.getManager/);
  assert.match(main,/isAMEInstalled/);
  assert.match(main,/launchEncoder/);
  assert.match(main,/startBatchEncode/);
  assert.match(main,/setEmbeddedXMPEnabled/);
  assert.match(main,/setSidecarXMPEnabled/);
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
