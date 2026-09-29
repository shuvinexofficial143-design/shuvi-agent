import {spawnSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import path from "node:path";
import process from "node:process";

export const SCHEMA_VERSION=3;
export const ASSURANCE="process_execution_record_not_cryptographically_signed";

export function parseScope(argv=process.argv.slice(2)){
  const i=argv.indexOf("--scope");
  const scope=i>=0?argv[i+1]:"full";
  if(!["frontend","rust","full"].includes(scope)) throw new Error("scope must be frontend, rust, or full");
  return scope;
}

export function commandPlan(scope){
  const frontend=[
    {name:"validate",command:process.platform==="win32"?"npm.cmd":"npm",args:["run","validate"]},
    {name:"node_tests",command:process.platform==="win32"?"npm.cmd":"npm",args:["test"]},
    {name:"frontend_build",command:process.platform==="win32"?"npm.cmd":"npm",args:["run","build"]},
  ];
  const rust=[
    {name:"cargo_check",command:"cargo",args:["check","--manifest-path","src-tauri/Cargo.toml"]},
    {name:"cargo_tests",command:"cargo",args:["test","--manifest-path","src-tauri/Cargo.toml","--lib"]},
  ];
  if(scope==="frontend") return frontend;
  if(scope==="rust") return rust;
  return [...frontend,...rust];
}

function run(command,args){
  const started=Date.now();
  const result=spawnSync(command,args,{cwd:process.cwd(),encoding:"utf8",stdio:["ignore","pipe","pipe"],shell:false});
  return {
    exit_code:typeof result.status==="number"?result.status:null,
    signal:result.signal??null,
    duration_ms:Date.now()-started,
    stdout_tail:(result.stdout??"").slice(-4000),
    stderr_tail:(result.stderr??"").slice(-4000),
    launch_error:result.error?.message??null,
  };
}

function gitText(args){
  const r=spawnSync("git",args,{cwd:process.cwd(),encoding:"utf8",stdio:["ignore","pipe","pipe"],shell:false});
  if(r.status!==0) throw new Error((r.stderr||"git command failed").trim());
  return r.stdout.trim();
}

export function outputName(scope,sha){
  const safe=sha.replace(/[^a-f0-9]/gi,"").slice(0,40)||"unknown";
  return `${scope}-${safe}.json`;
}

export function validateAttestation(a){
  const expectedNames=["frontend","rust","full"].includes(a?.scope)
    ? commandPlan(a.scope).map(command=>command.name)
    : [];
  const commandsValid=Array.isArray(a?.commands) && a.commands.length>0
    && a.commands.every(command=>
      command && typeof command==="object"
      && typeof command.name==="string" && command.name.length>0
      && typeof command.command==="string" && command.command.length>0
      && (command.exit_code===null || Number.isInteger(command.exit_code))
      && (command.launch_error===null || typeof command.launch_error==="string")
    );
  const observedPass=Boolean(
    a?.head_unchanged===true
    && a?.clean_worktree===true
    && commandsValid
    && a.commands.every(command=>command.exit_code===0 && command.launch_error===null)
  );
  return a?.schema_version===SCHEMA_VERSION
    && ["frontend","rust","full"].includes(a.scope)
    && typeof a.repository_commit==="string" && /^[a-f0-9]{40}$/i.test(a.repository_commit)
    && typeof a.repository_commit_after==="string" && /^[a-f0-9]{40}$/i.test(a.repository_commit_after)
    && typeof a.head_unchanged==="boolean"
    && a.head_unchanged===(a.repository_commit===a.repository_commit_after)
    && typeof a.clean_worktree_before==="boolean"
    && typeof a.clean_worktree_after==="boolean"
    && typeof a.clean_worktree==="boolean"
    && a.clean_worktree===(a.clean_worktree_before && a.clean_worktree_after)
    && commandsValid
    && a.commands.length===expectedNames.length
    && a.commands.every((command,index)=>command.name===expectedNames[index])
    && typeof a.passed==="boolean"
    && a.passed===observedPass
    && a.assurance===ASSURANCE;
}

export function execute(scope=parseScope()){
  const sha=gitText(["rev-parse","HEAD"]);
  const dirtyBefore=gitText(["status","--porcelain","--untracked-files=all"]);
  const cleanWorktreeBefore=dirtyBefore.length===0;
  const commands=[];
  for(const spec of commandPlan(scope)){
    const result=run(spec.command,spec.args);
    commands.push({
      name:spec.name,
      command:[spec.command,...spec.args].join(" "),
      ...result,
    });
  }
  const shaAfter=gitText(["rev-parse","HEAD"]);
  const headUnchanged=sha===shaAfter;
  const dirtyAfter=gitText(["status","--porcelain","--untracked-files=all"]);
  const cleanWorktreeAfter=dirtyAfter.length===0;
  const cleanWorktree=cleanWorktreeBefore && cleanWorktreeAfter;
  const passed=headUnchanged && cleanWorktree && commands.every(c=>c.exit_code===0 && !c.launch_error);
  const attestation={
    schema_version:SCHEMA_VERSION,
    generated_at:new Date().toISOString(),
    scope,
    repository_commit:sha,
    repository_commit_after:shaAfter,
    head_unchanged:headUnchanged,
    clean_worktree_before:cleanWorktreeBefore,
    clean_worktree_after:cleanWorktreeAfter,
    clean_worktree:cleanWorktree,
    platform:{os:process.platform,arch:process.arch,node:process.version},
    commands,
    passed,
    assurance:ASSURANCE,
    note:"This records observed process execution only when Git HEAD stayed on one exact commit and the worktree was clean before/after. It is not a signature and does not prove Premiere runtime behavior.",
  };
  if(!validateAttestation(attestation)) throw new Error("internal attestation validation failed");
  const dir=path.join(process.cwd(),".shuvi-attest");
  mkdirSync(dir,{recursive:true});
  const file=path.join(dir,outputName(scope,sha));
  writeFileSync(file,JSON.stringify(attestation,null,2)+"\n","utf8");
  console.log(JSON.stringify({
    attestation:file,scope,commit:sha,commit_after:shaAfter,head_unchanged:headUnchanged,passed,
    clean_worktree_before:cleanWorktreeBefore,
    clean_worktree_after:cleanWorktreeAfter,
    clean_worktree:cleanWorktree
  },null,2));
  if(!passed) process.exitCode=1;
  return attestation;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  execute();
}
