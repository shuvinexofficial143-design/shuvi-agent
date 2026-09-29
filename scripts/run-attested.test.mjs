import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
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
    schema_version:SCHEMA_VERSION,scope:"full",repository_commit:sha,
    clean_worktree_before:true,clean_worktree_after:true,clean_worktree:true,
    commands:[{name:"x",exit_code:0}],passed:true,assurance:ASSURANCE
  }),true);
  assert.equal(validateAttestation({
    schema_version:SCHEMA_VERSION,scope:"full",repository_commit:"main",
    clean_worktree_before:true,clean_worktree_after:true,clean_worktree:true,
    commands:[{name:"x",exit_code:0}],passed:true,assurance:ASSURANCE
  }),false);
});


test("attestation rejects dirty or internally inconsistent worktree receipts",()=>{
  const sha="b".repeat(40);
  const base={
    schema_version:SCHEMA_VERSION,scope:"frontend",repository_commit:sha,
    commands:[{name:"validate",exit_code:0}],passed:false,assurance:ASSURANCE
  };
  assert.equal(validateAttestation({
    ...base,clean_worktree_before:false,clean_worktree_after:true,clean_worktree:false
  }),true);
  assert.equal(validateAttestation({
    ...base,clean_worktree_before:true,clean_worktree_after:false,clean_worktree:false
  }),true);
  assert.equal(validateAttestation({
    ...base,clean_worktree_before:false,clean_worktree_after:true,clean_worktree:true
  }),false);
});


test("attestation source checks tracked and untracked cleanliness before and after commands",()=>{
  const source=readFileSync(new URL("./run-attested.mjs",import.meta.url),"utf8");
  const occurrences=[...source.matchAll(/status","--porcelain","--untracked-files=all/g)].length;
  assert.equal(occurrences,2);
  assert.match(source,/const cleanWorktreeBefore=dirtyBefore\.length===0/);
  assert.match(source,/const cleanWorktreeAfter=dirtyAfter\.length===0/);
  assert.match(source,/const cleanWorktree=cleanWorktreeBefore && cleanWorktreeAfter/);
});
