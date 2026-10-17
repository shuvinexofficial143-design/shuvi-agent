// M58 production entrypoint. Pinning is mandatory here; standard cargo
// test/dev builds are intentionally unpinned and cannot launch SHA workers.
// Does not download binaries, execute a shell, or accept a model-chosen path.
import {spawnSync,execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,readFileSync,statSync} from "node:fs";
import {resolve} from "node:path";

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
console.log("Pinned Shuvi SHA worker integrity guard embedded for target "+target+".");
console.log("WARNING: SHA pinning is not code signing; final installer signing and installed-Windows acceptance are separate.");
