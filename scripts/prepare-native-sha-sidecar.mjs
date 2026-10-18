// Build the fixed Windows SHA binary before Tauri NSIS bundling.
// Never downloads executables or uses a shell. Fail on unsupported targets.
import {spawnSync,execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {copyFileSync,statSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
if(process.platform!=="win32"){
  throw Error("Shuvi owned SHA sidecar requires a Windows build host.");
}
const host=execFileSync("rustc",["--print","host-tuple"],{encoding:"utf8"}).trim();
const target=process.env.CARGO_BUILD_TARGET||host;
if(!/^(?:x86_64|aarch64|i686)-pc-windows-msvc$/.test(target)){
  throw Error("Unsupported Windows target triple for contained native worker.");
}
const args=[
  "build","--locked","--release",
  "--manifest-path",join("src-tauri","Cargo.toml"),
  "--bin","shuvi-readonly-hash-worker","--features","sha-worker-build","--target",target
];
const result=spawnSync("cargo",args,{stdio:"inherit",shell:false,windowsHide:true});
if(result.error||result.status!==0){
  throw Error("Fixed-purpose Rust sidecar failed to compile for NSIS bundle.");
}
const source=resolve("src-tauri","target",target,"release","shuvi-readonly-hash-worker.exe");
const destDir=resolve("src-tauri","binaries");
mkdirSync(destDir,{recursive:true});
const dest=join(destDir,"shuvi-readonly-hash-worker-"+target+".exe");
if(statSync(source).size<1024)throw Error("Compiled SHA sidecar missing or truncated.");
copyFileSync(source,dest);
if(statSync(dest).size!==statSync(source).size){
  throw Error("Bundled SHA sidecar copy differs in length from compiled executable.");
}
const digest=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
if(digest(source)!==digest(dest)){
  throw Error("Prepared SHA sidecar copy disagrees with compiled executable.");
}
console.log("Compiled owned read-only SHA sidecar and matched SHA-256 bytes for NSIS target "+target);
