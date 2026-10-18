// M59 manual, bounded, Windows-only acceptance smoke for an ACTUALLY
// installed sidecar. This never runs Shuvi.exe, Adobe, Blender, GUI tools
// or any model-provided executable. It does not prove digital signatures.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {verifyInstalledWorker} from "./native-pinned-release-manifest.mjs";

if(process.platform!=="win32")throw Error("Installed Shuvi acceptance must run on an actual Windows computer.");
if(process.argv.length!==6||process.argv[2]!=="--manifest"||process.argv[4]!=="--install-dir"){
  throw Error("Usage: node scripts/check-installed-shuvi-worker.mjs --manifest FILE --install-dir PATH");
}
const manifestPath=resolve(process.argv[3]);
const installDir=resolve(process.argv[5]);
const {manifest,installedWorker}=verifyInstalledWorker({manifestPath,installDir});
const temp=mkdtempSync(join(tmpdir(),"shuvi-installed-readonly-"));
const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const sha=buffer=>createHash("sha256").update(buffer).digest("hex");
const launch=(id,input,digest,output)=>spawnSync(installedWorker,[
  "--shuvi-readonly-sha256",id,input,digest,output
],{cwd:temp,timeout:30000,encoding:"utf8",windowsHide:true,shell:false});
try{
  const input=join(temp,"exact-installed-sha-fixture.bin");
  const bytes=Buffer.from("Shuvi M59 installed sidecar exact-byte read-only fixture");
  writeFileSync(input,bytes,{flag:"wx"});
  const correct=sha(bytes);
  const proofFile=join(temp,"native-bg-hash-"+A+".json");
  const ok=launch(A,input,correct,proofFile);
  if(ok.error||ok.status!==0||!existsSync(proofFile)){
    throw Error("Installed fixed-purpose SHA worker failed real read-only protocol.");
  }
  const evidence=JSON.parse(readFileSync(proofFile,"utf8"));
  if(JSON.stringify(Object.keys(evidence).sort())!==JSON.stringify(
        ["actionId","inputBytes","inputSha256","source","version"].sort())
    ||evidence.version!==1||evidence.actionId!==A
    ||evidence.inputBytes!==bytes.length||evidence.inputSha256!==correct
    ||evidence.source!=="owned_windows_sha256_sidecar"){
    throw Error("Installed worker emitted invalid or mismatched SHA evidence.");
  }
  // Immutable receipt and negative digest proof: not merely exit-code 0.
  if(launch(A,input,correct,proofFile).status===0){
    throw Error("Installed sidecar unexpectedly overwrote existing UUID evidence.");
  }
  const refused=join(temp,"native-bg-hash-"+B+".json");
  const bad=launch(B,input,"0".repeat(64),refused);
  if(bad.status===0||existsSync(refused))throw Error("Installed worker accepted incorrect expected SHA.");
  const invalid=spawnSync(installedWorker,["--unapproved-operation"],{
    cwd:temp,timeout:30000,encoding:"utf8",windowsHide:true,shell:false
  });
  if(invalid.status===0)throw Error("Installed worker accepted unapproved command.");
  const result={
    schemaVersion:1,target:manifest.target,
    installedWorkerSha256:manifest.workerSha256,
    exactReadOnlyShaProtocolVerified:true,
    shaMismatchRejected:true,uuidEvidenceReplayRejected:true,
    unknownCommandRejected:true,
    codeSigningVerified:false,mainApplicationVerified:false,
    ownerDesktopEndToEndVerified:false,autoRetryAuthorized:false
  };
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}finally{
  rmSync(temp,{recursive:true,force:true});
}
