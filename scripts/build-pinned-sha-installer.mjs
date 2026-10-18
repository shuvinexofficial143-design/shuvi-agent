// M58 production entrypoint. Pinning is mandatory here; standard cargo
// test/dev builds are intentionally unpinned and cannot launch SHA workers.
// Does not download binaries, execute a shell, or accept a model-chosen path.
import {spawnSync,execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,readFileSync,statSync,mkdirSync,writeFileSync} from "node:fs";
import {createUnsignedReleaseEvidence,verifyUnsignedReleaseEvidence} from "./native-pinned-release-manifest.mjs";
import {resolve,join} from "node:path";

if(process.platform!=="win32")throw Error("Pinned Shuvi installer requires Windows build host.");
const host=execFileSync("rustc",["--print","host-tuple"],{encoding:"utf8"}).trim();
const target=process.env.CARGO_BUILD_TARGET||host;
if(!/^(?:x86_64|aarch64|i686)-pc-windows-msvc$/.test(target)){
  throw Error("Pinned installer requires supported Windows MSVC target.");
}
const sidecar=resolve("src-tauri","binaries","shuvi-readonly-hash-worker-"+target+".exe");
const tauriJs=resolve("node_modules","@tauri-apps","cli","tauri.js");
if(!existsSync(tauriJs)||!existsSync(sidecar))throw Error("Missing Tauri CLI or prepared SHA sidecar.");
const sha=()=>createHash("sha256").update(readFileSync(sidecar)).digest("hex");
const size=statSync(sidecar).size;
if(size<1024||size>32*1024*1024)throw Error("Refusing unbounded or missing prepared worker.");
const before=sha();
const env={...process.env,SHUVI_REQUIRE_PINNED_SHA_SIDECAR:"1",CARGO_BUILD_TARGET:target};
// Explicit CLI target is mandatory: Cargo env CARGO_BUILD_TARGET alone
// makes cargo write target/TRIPLE/release while Tauri otherwise bundles
// from target/release, producing a nonexistent main EXE path.
const r=spawnSync(process.execPath,[tauriJs,"build","--target",target,"--config","src-tauri/tauri.sha-sidecar.conf.json"],{
  env,stdio:"inherit",shell:false,windowsHide:true
});
if(r.error||r.status!==0)throw Error("Pinned Windows NSIS build failed or was interrupted.");
if(sha()!==before||statSync(sidecar).size!==size){
  throw Error("Prepared fixed SHA sidecar bytes changed during installer build.");
}
// Build completed; independently hash the single actual NSIS setup EXE
// together with the exact fixed compiled SHA worker staged for Tauri.
const nsis=resolve("src-tauri","target",target,"release","bundle","nsis");
const manifestDir=resolve(".shuvi-release");
mkdirSync(manifestDir,{recursive:true});
const manifestPath=join(manifestDir,"shuvi-pinned-nsis-"+target+".json");
const manifest=createUnsignedReleaseEvidence({
  target,sidecarPath:sidecar,nsisDir:nsis,outPath:manifestPath,
});
verifyUnsignedReleaseEvidence({manifestPath,sidecarPath:sidecar,nsisDir:nsis});
if(manifest.workerSha256!==before){
  throw Error("NSIS output worker hash does not match the compile-time main EXE pin input.");
}
// M60: fail the production build if the REAL compressed NSIS payload has
// no exact fixed worker or it differs byte-for-byte from the pinned source.
// Never EXECUTE the installer during this inspection.
const payload=spawnSync("powershell.exe",[
  "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
  "-File",resolve("scripts","check-real-nsis-payload.ps1"),
  "-ManifestPath",manifestPath,
  "-NsiBundleDirectory",nsis,
  "-SidecarPath",sidecar
],{encoding:"utf8",stdio:"pipe",shell:false,windowsHide:true,maxBuffer:512*1024});
if(payload.error||payload.status!==0){
  throw Error("Actual compressed NSIS worker payload mismatches pinned SHA or is uninspectable: "+String(payload.stderr||"").slice(0,500));
}
// M63: the ACTUAL packed main EXE is content-attested independently of the
// compiled fixed worker, allowing the disposable CI installer test to prove
// it installed exactly the MAIN EXE found inside this immutable NSIS.
let proven;
try{proven=JSON.parse(payload.stdout.trim());}
catch{throw Error("NSIS extraction returned no typed package content evidence.");}
const expectedKeys=[
  "schemaVersion","actualNsisPayloadExtracted","exactPackedWorkerSha256Matched",
  "realPackedReadOnlyWorkerExecuted","badDigestAndReplayRejected",
  "singlePackedDesktopExeFound","packedMainExeBytes","packedMainExeSha256",
  "packedWorkerSha256","installerSha256","signingVerified",
  "installedWindowsVerified","mainApplicationVerified",
  "ownerDesktopEndToEndVerified","autoRetryAuthorized"
].sort();
if(!proven||JSON.stringify(Object.keys(proven).sort())!==JSON.stringify(expectedKeys)
  ||proven.schemaVersion!==1||proven.actualNsisPayloadExtracted!==true
  ||proven.exactPackedWorkerSha256Matched!==true
  ||proven.realPackedReadOnlyWorkerExecuted!==true
  ||proven.badDigestAndReplayRejected!==true
  ||proven.singlePackedDesktopExeFound!==true
  ||!Number.isSafeInteger(proven.packedMainExeBytes)
  ||proven.packedMainExeBytes<1024||proven.packedMainExeBytes>512*1024*1024
  ||typeof proven.packedMainExeSha256!=="string"
  ||!/^[0-9a-f]{64}$/.test(proven.packedMainExeSha256)
  ||proven.packedWorkerSha256!==manifest.workerSha256
  ||proven.installerSha256!==manifest.installerSha256
  ||proven.signingVerified!==false||proven.installedWindowsVerified!==false
  ||proven.mainApplicationVerified!==false
  ||proven.ownerDesktopEndToEndVerified!==false
  ||proven.autoRetryAuthorized!==false){
  throw Error("NSIS extracted main app or worker content evidence invalid/incomplete.");
}
const packedMainWitnessPath=join(manifestDir,"m63-packed-main-"+target+".json");
writeFileSync(packedMainWitnessPath,JSON.stringify({
  schemaVersion:1,target,installerSha256:manifest.installerSha256,
  packedMainExeSha256:proven.packedMainExeSha256,
  packedMainExeBytes:proven.packedMainExeBytes,
  signingVerified:false,ownerWindowsVerified:false,applicationVerified:false
},null,2)+"\n",{encoding:"utf8",flag:"wx"});
console.log("M63 immutable packed main EXE content witness: "+packedMainWitnessPath);
console.log("Pinned Shuvi SHA worker integrity guard embedded for target "+target+".");
console.log("Unsigned NSIS release witness: "+manifestPath);
console.log("Installer SHA-256: "+manifest.installerSha256);
console.log("Worker SHA-256: "+manifest.workerSha256);
console.log("WARNING: SHA pinning is not code signing; final installer signing and installed-Windows acceptance are separate.");
