// M58 production entrypoint. Pinning is mandatory here; standard cargo
// test/dev builds are intentionally unpinned and cannot launch SHA workers.
// Does not download binaries, execute a shell, or accept a model-chosen path.
import {spawnSync,execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,readFileSync,statSync,mkdirSync} from "node:fs";
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
const r=spawnSync(process.execPath,[tauriJs,"build","--config","src-tauri/tauri.sha-sidecar.conf.json"],{
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
],{stdio:"inherit",shell:false,windowsHide:true});
if(payload.error||payload.status!==0){
  throw Error("Actual compressed NSIS worker payload mismatches pinned SHA or is uninspectable.");
}
console.log("Pinned Shuvi SHA worker integrity guard embedded for target "+target+".");
console.log("Unsigned NSIS release witness: "+manifestPath);
console.log("Installer SHA-256: "+manifest.installerSha256);
console.log("Worker SHA-256: "+manifest.workerSha256);
console.log("WARNING: SHA pinning is not code signing; final installer signing and installed-Windows acceptance are separate.");
