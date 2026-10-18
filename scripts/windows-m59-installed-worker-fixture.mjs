// M59 genuine Windows-process protocol fixture; synthetic NSIS bytes + stub
// main EXE are explicitly NOT real installed NSIS/Authenticode acceptance.
// CI uses the already compiled real Rust SHA worker and exercises the SAME
// manual installed-smoke entrypoint with exact SHA and tamper rejection.
import {spawnSync} from "node:child_process";
import {copyFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createUnsignedReleaseEvidence} from "./native-pinned-release-manifest.mjs";

if(process.platform!=="win32")throw Error("M59 real process acceptance fixture requires Windows.");
const bin=resolve("src-tauri","target","debug","shuvi-readonly-hash-worker.exe");
if(!existsSync(bin))throw Error("Build real Windows SHA worker before the M59 fixture.");
const target="x86_64-pc-windows-msvc";
const root=mkdtempSync(join(tmpdir(),"shuvi-m59-win-fixture-"));
const stage=join(root,"stage"),nsis=join(root,"nsis"),install=join(root,"install");
mkdirSync(stage);mkdirSync(nsis);mkdirSync(install);
const staged=join(stage,"shuvi-readonly-hash-worker-"+target+".exe");
const installed=join(install,"shuvi-readonly-hash-worker.exe");
const witness=join(root,"unsigned-evidence.json");
const run=()=>spawnSync(process.execPath,[
  "scripts/check-installed-shuvi-worker.mjs",
  "--manifest",witness,"--install-dir",install,
],{cwd:resolve("."),timeout:60000,encoding:"utf8",shell:false,windowsHide:true});
try{
  copyFileSync(bin,staged);
  copyFileSync(bin,installed);
  // Intentional STUB: this never claims actual GUI application installed.
  writeFileSync(join(install,"shuvi.exe"),Buffer.alloc(4096,0x6d),{flag:"wx"});
  writeFileSync(join(nsis,"Shuvi_0.1.3_x64-setup.exe"),Buffer.alloc(8192,0x6e),{flag:"wx"});
  createUnsignedReleaseEvidence({
    target,sidecarPath:staged,nsisDir:nsis,outPath:witness,
  });
  const good=run();
  if(good.error||good.status!==0)throw Error("Real Windows M59 worker acceptance smoke failed: "+good.stderr);
  const output=JSON.parse(good.stdout);
  if(output.exactReadOnlyShaProtocolVerified!==true
     ||output.shaMismatchRejected!==true||output.uuidEvidenceReplayRejected!==true
     ||output.unknownCommandRejected!==true||output.codeSigningVerified!==false
     ||output.mainApplicationVerified!==false||output.ownerDesktopEndToEndVerified!==false){
    throw Error("M59 Windows fixture falsely certified app/signing or missed worker protocol.");
  }
  writeFileSync(installed,Buffer.alloc(4096,0x7f));
  const bad=run();
  if(bad.status===0)throw Error("Modified installed Windows worker incorrectly accepted.");
  console.log("PASS M59 real Windows SHA protocol and installed-content tamper gate.");
  console.log("FIXTURE ONLY: NSIS setup and main EXE are synthetic; no signed/live Windows installation claim.");
}finally{rmSync(root,{recursive:true,force:true});}
