import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust = readFileSync("src-tauri/src/lib.rs", "utf8");
const harness = readFileSync("src-tauri/src/premiere_acceptance_harness.rs", "utf8");

test("disposable registration and bounded plan are routed through approved typed tools", () => {
  for (const tool of ["premiere_acceptance_register_disposable", "premiere_acceptance_plan"]) {
    assert.ok(rust.includes(`"${tool}" =>`));
    assert.ok(rust.includes(`| "${tool}"`));
  }
  assert.match(rust, /PremiereAcceptanceRegisterDisposable[^]*?RiskLevel::High/);
  assert.match(harness, /const MAX_ACTIONS: usize = 12/);
  assert.match(harness, /requires_prproj_checkpoint/);
  assert.match(harness, /requires_exact_expectation/);
  assert.match(harness, /registration\.zip\(context\)/);
});
