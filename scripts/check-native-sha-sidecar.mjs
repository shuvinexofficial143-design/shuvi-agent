// A real Windows executable smoke/integrity test. Do not run a shell.
// This is invoked ONLY by the Windows GitHub CI job after cargo builds the
// exact fixed-purpose sidecar; it never invokes Blender or Adobe.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

if (process.platform!=="win32") throw Error("This test requires real Windows process execution.");
const binary=resolve("src-tauri","target","debug","shuvi-readonly-hash-worker.exe");
if (!existsSync(binary)) throw Error("Fixed SHA sidecar was not compiled by cargo.");
const temp=mkdtempSync(join(tmpdir(),"shuvi-real-sha-"));
const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
function exec(id,file,sha,out){
  return spawnSync(binary,["--shuvi-readonly-sha256",id,file,sha,out],{
    cwd:temp,timeout:20_000,encoding:"utf8",windowsHide:true
  });
}
try{
  const input=join(temp,"owned-input.bin");
  writeFileSync(input,Buffer.from("owned background worker real SHA-256 fixture"));
  const expected=createHash("sha256").update(readFileSync(input)).digest("hex");
  const output=join(temp,"native-bg-hash-"+A+".json");
  const ok=exec(A,input,expected,output);
  if(ok.error||ok.status!==0)throw Error("Real SHA child failed: "+(ok.stderr||ok.error));
  const proof=JSON.parse(readFileSync(output,"utf8"));
  if(proof.version!==1||proof.actionId!==A||proof.inputSha256!==expected
      ||proof.inputBytes!==readFileSync(input).length
      ||proof.source!=="owned_windows_sha256_sidecar"){
    throw Error("Worker output disagrees with real bytes or exact UUID.");
  }
  // Create-new evidence must never be silently overwritten on UUID replay.
  if(exec(A,input,expected,output).status===0)throw Error("Replay overwrote evidence.");
  const foreign=join(temp,"native-bg-hash-"+B+".json");
  if(exec(B,input,"f".repeat(64),foreign).status===0||existsSync(foreign)){
    throw Error("Wrong expected digest fabricated a successful SHA result.");
  }
  // Changed input cannot reuse an old approved digest.
  writeFileSync(input,Buffer.from("a changed input after approval"));
  if(exec(B,input,expected,foreign).status===0||existsSync(foreign)){
    throw Error("Mutated input falsely received SHA verification.");
  }
  const invalid=spawnSync(binary,["--unexpected-command"],{cwd:temp,timeout:20_000});
  if(invalid.status===0)throw Error("Arbitrary worker command unexpectedly allowed.");
  console.log("PASS: real Windows SHA binary, strict UUID, immutable create-new evidence, wrong SHA, tamper and invalid argument rejection.");
}finally{
  rmSync(temp,{recursive:true,force:true});
}
