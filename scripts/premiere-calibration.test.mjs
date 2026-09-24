import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const source=readFileSync("src-tauri/src/premiere_calibration.rs","utf8");

test("calibration is exact, disposable for writes, bounded and restored before native verification",()=>{
  for(const name of ["premiere_calibration_report","premiere_calibration_observe","premiere_calibration_probe"]){
    assert.ok(desktop.includes(`"${name}"`));
  }
  assert.match(desktop,/PremiereCalibrationProbe[\s\S]*?RiskLevel::High/);
  assert.match(desktop,/PremiereCalibrationProbe \{target,delta\}[\s\S]*?premiere_disposable_path\(app\)/);
  assert.match(desktop,/action:make_action\(baseline\.clone\(\)\)/);
  assert.match(desktop,/native_delta_verified=exact_delta && recovered/);
  assert.match(source,/unit:"native_unknown"/);
  assert.match(source,/semantic_verified:false/);
  assert.match(source,/delta\.abs\(\)>1\.0/);
  assert.match(source,/e\.semantic_verified && e\.native_delta_verified && e\.recovery_verified/);
});
