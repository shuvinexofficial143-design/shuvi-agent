import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {
  createUnsignedReleaseEvidence,verifyUnsignedReleaseEvidence,verifyInstalledWorker
} from "./native-pinned-release-manifest.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const workerSource=read("scripts/check-installed-shuvi-worker.mjs");
const signatures=read("scripts/check-shuvi-release-signatures.ps1");
const installerBuilder=read("scripts/build-pinned-sha-installer.mjs");
const target="x86_64-pc-windows-msvc";
const sidecar="shuvi-readonly-hash-worker-"+target+".exe";
const filename="Shuvi_0.1.3_x64-setup.exe";
function fixture(){
  const d=mkdtempSync(join(tmpdir(),"shuvi-m59-release-"));
  const stage=join(d,"stage"),nsis=join(d,"nsis"),install=join(d,"install");
  mkdirSync(stage);mkdirSync(nsis);mkdirSync(install);
  const workerPath=join(stage,sidecar);
  const installerPath=join(nsis,filename);
  const installedPath=join(install,"shuvi-readonly-hash-worker.exe");
  const manifestPath=join(d,"evidence.json");
  writeFileSync(workerPath,Buffer.alloc(2400,0x5a));
  writeFileSync(installerPath,Buffer.alloc(4800,0x6a));
  writeFileSync(installedPath,Buffer.alloc(2400,0x5a));
  writeFileSync(join(install,"shuvi.exe"),Buffer.alloc(4500,0x79));
  return {d,stage,nsis,install,workerPath,installerPath,installedPath,manifestPath};
}
function create(f){
  return createUnsignedReleaseEvidence({
    target,sidecarPath:f.workerPath,nsisDir:f.nsis,outPath:f.manifestPath
  });
}
test("M59 manifest deterministically binds exactly one real NSIS installer and compiled SHA worker",()=>{
  const f=fixture();
  try{
    const m=create(f);
    assert.equal(m.target,target);
    assert.match(m.workerSha256,/^[0-9a-f]{64}$/);
    assert.match(m.installerSha256,/^[0-9a-f]{64}$/);
    assert.equal(m.signingVerified,false);
    assert.equal(m.installedWindowsVerified,false);
    assert.equal(m.applicationVerified,false);
    assert.deepEqual(verifyUnsignedReleaseEvidence({
      manifestPath:f.manifestPath,sidecarPath:f.workerPath,nsisDir:f.nsis
    }),m);
    assert.equal(verifyInstalledWorker({
      manifestPath:f.manifestPath,installDir:f.install
    }).manifest.workerSha256,m.workerSha256);
    assert.throws(()=>create(f),/EEXIST/); // cannot overwrite prior witness
  }finally{rmSync(f.d,{recursive:true,force:true});}
});
test("M59 any changed installed SHA worker or NSIS setup fails closed",()=>{
  const f=fixture();
  try{
    create(f);
    writeFileSync(f.installedPath,Buffer.alloc(2400,0x6b));
    assert.throws(()=>verifyInstalledWorker({
      manifestPath:f.manifestPath,installDir:f.install
    }),/does not match/);
    writeFileSync(f.installerPath,Buffer.alloc(4800,0x6b));
    assert.throws(()=>verifyUnsignedReleaseEvidence({
      manifestPath:f.manifestPath,sidecarPath:f.workerPath,nsisDir:f.nsis
    }),/changed/);
  }finally{rmSync(f.d,{recursive:true,force:true});}
});
test("M59 forbids second installer, malformed manifest, worker aliases and false signed status",()=>{
  const f=fixture();
  try{
    writeFileSync(join(f.nsis,"Shuvi_0.1.3_arm64-setup.exe"),Buffer.alloc(4800,0x3b));
    assert.throws(()=>create(f),/One and only one/);
    rmSync(join(f.nsis,"Shuvi_0.1.3_arm64-setup.exe"));
    create(f);
    const forged=JSON.parse(readFileSync(f.manifestPath,"utf8"));
    forged.signingVerified=true;
    writeFileSync(f.manifestPath,JSON.stringify(forged));
    assert.throws(()=>verifyInstalledWorker({
      manifestPath:f.manifestPath,installDir:f.install
    }),/schema/);
    assert.throws(()=>createUnsignedReleaseEvidence({
      target:"linux-x64",sidecarPath:f.workerPath,nsisDir:f.nsis,outPath:join(f.d,"bad.json")
    }),/Windows MSVC/);
    // No path-selected binary or symlink alias may be admitted.
    assert.throws(()=>createUnsignedReleaseEvidence({
      target,sidecarPath:join(f.stage,"rogue.exe"),nsisDir:f.nsis,outPath:join(f.d,"wrong.json")
    }),/exact compiled Tauri sidecar/);
  }finally{rmSync(f.d,{recursive:true,force:true});}
});
test("M59 manual installed sidecar protocol is strictly Windows-only read-only and never reports creative app success",()=>{
  assert.match(workerSource,/process\.platform!=="win32"/);
  assert.match(workerSource,/verifyInstalledWorker\(/);
  assert.match(workerSource,/shaMismatchRejected:true/);
  assert.match(workerSource,/uuidEvidenceReplayRejected:true/);
  assert.match(workerSource,/unknownCommandRejected:true/);
  assert.match(workerSource,/shell:false/);
  assert.match(workerSource,/mainApplicationVerified:false/);
  assert.match(workerSource,/ownerDesktopEndToEndVerified:false/);
  assert.doesNotMatch(workerSource,/Blender\.exe|Premiere\.exe|powershell\.exe|cmd\.exe/);
});
test("M59 release signatures must be separately anchored to exact trusted publisher thumbprint",()=>{
  assert.match(signatures,/Get-AuthenticodeSignature -LiteralPath \$file/);
  assert.match(signatures,/\$signature\.Status -ne 'Valid'/);
  assert.match(signatures,/ExpectedSignerThumbprint/);
  assert.match(signatures,/SignerCertificate\.Thumbprint/);
  assert.match(signatures,/Get-FileHash -LiteralPath \$installer -Algorithm SHA256/);
  assert.match(signatures,/Get-FileHash -LiteralPath \$worker -Algorithm SHA256/);
  assert.match(signatures,/mainApplicationVerified = \$false/);
  assert.match(installerBuilder,/createUnsignedReleaseEvidence/);
  assert.match(installerBuilder,/verifyUnsignedReleaseEvidence/);
  assert.match(installerBuilder,/manifest\.workerSha256!==before/);
  assert.match(installerBuilder,/SHUVI_REQUIRE_PINNED_SHA_SIDECAR:"1"/);
});
