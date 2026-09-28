import test from "node:test";
import assert from "node:assert/strict";
import {ASSURANCE,SCHEMA_VERSION,commandPlan,outputName,parseScope,validateAttestation} from "./run-attested.mjs";

test("attestation scopes use closed command plans",()=>{
  assert.deepEqual(commandPlan("frontend").map(v=>v.name),["validate","node_tests","frontend_build"]);
  assert.deepEqual(commandPlan("rust").map(v=>v.name),["cargo_check","cargo_tests"]);
  assert.deepEqual(commandPlan("full").map(v=>v.name),["validate","node_tests","frontend_build","cargo_check","cargo_tests"]);
  assert.equal(parseScope(["--scope","rust"]),"rust");
  assert.throws(()=>parseScope(["--scope","unknown"]));
});

test("attestation filename and shape are commit bound",()=>{
  const sha="a".repeat(40);
  assert.equal(outputName("full",sha),`full-${sha}.json`);
  assert.equal(validateAttestation({
    schema_version:SCHEMA_VERSION,scope:"full",repository_commit:sha,clean_worktree:true,
    commands:[{name:"x",exit_code:0}],passed:true,assurance:ASSURANCE
  }),true);
  assert.equal(validateAttestation({
    schema_version:SCHEMA_VERSION,scope:"full",repository_commit:"main",clean_worktree:true,
    commands:[{name:"x",exit_code:0}],passed:true,assurance:ASSURANCE
  }),false);
});
