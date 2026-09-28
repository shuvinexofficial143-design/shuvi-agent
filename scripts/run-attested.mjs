import {spawnSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import path from "node:path";
import process from "node:process";

export const SCHEMA_VERSION=1;
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
  return a?.schema_version===SCHEMA_VERSION
    && ["frontend","rust","full"].includes(a.scope)
    && typeof a.repository_commit==="string" && /^[a-f0-9]{40}$/i.test(a.repository_commit)
    && typeof a.clean_worktree==="boolean"
    && Array.isArray(a.commands) && a.commands.length>0
    && typeof a.passed==="boolean"
    && a.assurance===ASSURANCE;
}

export function execute(scope=parseScope()){
  const sha=gitText(["rev-parse","HEAD"]);
  const dirty=gitText(["status","--porcelain","--untracked-files=no"]);
  const cleanWorktree=dirty.length===0;
  const commands=[];
  for(const spec of commandPlan(scope)){
    const result=run(spec.command,spec.args);
    commands.push({
      name:spec.name,
      command:[spec.command,...spec.args].join(" "),
      ...result,
    });
  }
  const passed=cleanWorktree && commands.every(c=>c.exit_code===0 && !c.launch_error);
  const attestation={
    schema_version:SCHEMA_VERSION,
    generated_at:new Date().toISOString(),
    scope,
    repository_commit:sha,
    clean_worktree:cleanWorktree,
    platform:{os:process.platform,arch:process.arch,node:process.version},
    commands,
    passed,
    assurance:ASSURANCE,
    note:"This records observed process execution for one exact Git commit. It is not a signature and does not prove Premiere runtime behavior.",
  };
  if(!validateAttestation(attestation)) throw new Error("internal attestation validation failed");
  const dir=path.join(process.cwd(),".shuvi-attest");
  mkdirSync(dir,{recursive:true});
  const file=path.join(dir,outputName(scope,sha));
  writeFileSync(file,JSON.stringify(attestation,null,2)+"\n","utf8");
  console.log(JSON.stringify({attestation:file,scope,commit:sha,passed,clean_worktree:cleanWorktree},null,2));
  if(!passed) process.exitCode=1;
  return attestation;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  execute();
}
