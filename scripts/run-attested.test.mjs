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
    repository_commit_after:sha,head_unchanged:true,
    clean_worktree_before:true,clean_worktree_after:true,clean_worktree:true,
    commands:[{name:"validate",command:"validate",exit_code:0,launch_error:null},{name:"node_tests",command:"node_tests",exit_code:0,launch_error:null},{name:"frontend_build",command:"frontend_build",exit_code:0,launch_error:null},{name:"cargo_check",command:"cargo_check",exit_code:0,launch_error:null},{name:"cargo_tests",command:"cargo_tests",exit_code:0,launch_error:null}],passed:true,assurance:ASSURANCE
  }),true);
  assert.equal(validateAttestation({
    schema_version:SCHEMA_VERSION,scope:"full",repository_commit:"main",
    repository_commit_after:sha,head_unchanged:false,
    clean_worktree_before:true,clean_worktree_after:true,clean_worktree:true,
    commands:[{name:"validate",command:"validate",exit_code:0,launch_error:null},{name:"node_tests",command:"node_tests",exit_code:0,launch_error:null},{name:"frontend_build",command:"frontend_build",exit_code:0,launch_error:null},{name:"cargo_check",command:"cargo_check",exit_code:0,launch_error:null},{name:"cargo_tests",command:"cargo_tests",exit_code:0,launch_error:null}],passed:true,assurance:ASSURANCE
  }),false);
});


test("attestation rejects dirty or internally inconsistent worktree receipts",()=>{
  const sha="b".repeat(40);
  const base={
    schema_version:SCHEMA_VERSION,scope:"frontend",repository_commit:sha,
    repository_commit_after:sha,head_unchanged:true,
    commands:[{name:"validate",command:"validate",exit_code:0,launch_error:null},{name:"node_tests",command:"node_tests",exit_code:0,launch_error:null},{name:"frontend_build",command:"frontend_build",exit_code:0,launch_error:null}],passed:false,assurance:ASSURANCE
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


test("attestation rejects HEAD changes during verification",()=>{
  const before="c".repeat(40);
  const after="d".repeat(40);
  const common={
    schema_version:SCHEMA_VERSION,scope:"frontend",repository_commit:before,
    clean_worktree_before:true,clean_worktree_after:true,clean_worktree:true,
    commands:[{name:"validate",command:"validate",exit_code:0,launch_error:null},{name:"node_tests",command:"node_tests",exit_code:0,launch_error:null},{name:"frontend_build",command:"frontend_build",exit_code:0,launch_error:null}],assurance:ASSURANCE
  };
  assert.equal(validateAttestation({
    ...common,repository_commit_after:after,head_unchanged:false,passed:false
  }),true);
  assert.equal(validateAttestation({
    ...common,repository_commit_after:after,head_unchanged:true,passed:true
  }),false);
  assert.equal(validateAttestation({
    ...common,repository_commit_after:before,head_unchanged:false,passed:false
  }),false);
});

test("attestation source binds process results to unchanged HEAD",()=>{
  const source=readFileSync(new URL("./run-attested.mjs",import.meta.url),"utf8");
  const revParses=[...source.matchAll(/rev-parse","HEAD/g)].length;
  assert.equal(revParses,2);
  assert.match(source,/const shaAfter=gitText\(\["rev-parse","HEAD"\]\)/);
  assert.match(source,/const headUnchanged=sha===shaAfter/);
  assert.match(source,/const passed=headUnchanged && cleanWorktree/);
  assert.match(source,/repository_commit_after:shaAfter/);
  assert.match(source,/head_unchanged:headUnchanged/);
});


test("attestation passed flag must match observed command outcomes",()=>{
  const sha="e".repeat(40);
  const base={
    schema_version:SCHEMA_VERSION,scope:"frontend",
    repository_commit:sha,repository_commit_after:sha,head_unchanged:true,
    clean_worktree_before:true,clean_worktree_after:true,clean_worktree:true,
    assurance:ASSURANCE
  };
  const passing=[{name:"validate",command:"validate",exit_code:0,launch_error:null},{name:"node_tests",command:"node_tests",exit_code:0,launch_error:null},{name:"frontend_build",command:"frontend_build",exit_code:0,launch_error:null}];
  const failedExit=passing.map((command,index)=>index===0?{...command,exit_code:1}:command);
  const launchFailure=passing.map((command,index)=>index===0?{...command,launch_error:"spawn failed"}:command);
  assert.equal(validateAttestation({...base,commands:failedExit,passed:true}),false);
  assert.equal(validateAttestation({...base,commands:failedExit,passed:false}),true);
  assert.equal(validateAttestation({...base,commands:launchFailure,passed:true}),false);
});

test("attestation rejects malformed command execution records",()=>{
  const sha="f".repeat(40);
  const base={
    schema_version:SCHEMA_VERSION,scope:"frontend",
    repository_commit:sha,repository_commit_after:sha,head_unchanged:true,
    clean_worktree_before:true,clean_worktree_after:true,clean_worktree:true,
    passed:true,assurance:ASSURANCE
  };
  const passing=[{name:"validate",command:"validate",exit_code:0,launch_error:null},{name:"node_tests",command:"node_tests",exit_code:0,launch_error:null},{name:"frontend_build",command:"frontend_build",exit_code:0,launch_error:null}];
  assert.equal(validateAttestation({...base,commands:passing.map((command,index)=>index===0?{...command,exit_code:"0"}:command)}),false);
  assert.equal(validateAttestation({...base,commands:passing.map((command,index)=>index===0?{...command,name:""}:command)}),false);
  assert.equal(validateAttestation({...base,commands:passing.map((command,index)=>index===0?{...command,command:""}:command)}),false);
});


test("attestation requires the exact command names for its scope",()=>{
  const sha="1".repeat(40);
  const base={
    schema_version:SCHEMA_VERSION,scope:"frontend",
    repository_commit:sha,repository_commit_after:sha,head_unchanged:true,
    clean_worktree_before:true,clean_worktree_after:true,clean_worktree:true,
    passed:true,assurance:ASSURANCE
  };
  const passing=[{name:"validate",command:"validate",exit_code:0,launch_error:null},{name:"node_tests",command:"node_tests",exit_code:0,launch_error:null},{name:"frontend_build",command:"frontend_build",exit_code:0,launch_error:null}];
  assert.equal(validateAttestation({...base,commands:passing}),true);
  assert.equal(validateAttestation({...base,commands:passing.slice(0,2)}),false);
  assert.equal(validateAttestation({...base,commands:[passing[1],passing[0],passing[2]]}),false);
  assert.equal(validateAttestation({...base,commands:passing.map((command,index)=>index===1?{...command,name:"other"}:command)}),false);
});
