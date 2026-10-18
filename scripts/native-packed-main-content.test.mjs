import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,linkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {verifyPackedMainContent} from "./native-packed-main-content.mjs";
const hash=b=>createHash("sha256").update(b).digest("hex");
const target="x86_64-pc-windows-msvc",bytes=Buffer.alloc(4096,0x5b);
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"shuvi-m63-main-")),installed=join(dir,"installed");
  mkdirSync(installed);
  const mainExecutablePath=join(installed,"shuvi.exe");
  const witnessPath=join(dir,"main.json");
  writeFileSync(mainExecutablePath,bytes);
  const manifest={
    schemaVersion:1,target,installerSha256:"a".repeat(64),
    packedMainExeSha256:hash(bytes),packedMainExeBytes:bytes.length,
    signingVerified:false,ownerWindowsVerified:false,applicationVerified:false
  };
  writeFileSync(witnessPath,JSON.stringify(manifest));
  return {dir,installed,mainExecutablePath,witnessPath,manifest};
}
function verify(f,args={}){
  return verifyPackedMainContent({
    witnessPath:f.witnessPath,mainExecutablePath:f.mainExecutablePath,
    installerSha256:"a".repeat(64),target,...args
  });
}
test("M63 verifies actual packed main identity by streaming same bytes, exact size and installer SHA",()=>{
  const f=fixture();
  try{
    assert.deepEqual(verify(f),f.manifest);
    assert.equal(verify(f).applicationVerified,false);
    assert.equal(verify(f).ownerWindowsVerified,false);
    assert.equal(verify(f).signingVerified,false);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("M63 rejects replaced installed desktop EXE, even with same byte length",()=>{
  const f=fixture();
  try{
    writeFileSync(f.mainExecutablePath,Buffer.alloc(bytes.length,0x66));
    assert.throws(()=>verify(f),/differs from real compressed NSIS/);
    writeFileSync(f.mainExecutablePath,Buffer.alloc(1000,0x66));
    assert.throws(()=>verify(f),/bounded single-link regular|differs/);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("M63 refuses a forged successful app/signing claim, changed installer SHA, changed target or extra metadata",()=>{
  const f=fixture();
  try{
    assert.throws(()=>verify(f,{installerSha256:"b".repeat(64)}),/malformed or mismatched/);
    assert.throws(()=>verify(f,{target:"aarch64-pc-windows-msvc"}),/malformed or mismatched/);
    for(const alteration of [
      m=>{m.signingVerified=true;},
      m=>{m.ownerWindowsVerified=true;},
      m=>{m.applicationVerified=true;},
      m=>{m.packedMainExeSha256="B".repeat(64);},
      m=>{m.extraneous="owner-approved";},
    ]){
      const clone=structuredClone(f.manifest);alteration(clone);
      writeFileSync(f.witnessPath,JSON.stringify(clone));
      assert.throws(()=>verify(f),/malformed or mismatched/);
    }
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("M63 denied hardlinked desktop binary, foreign executable name and malformed witness",()=>{
  const f=fixture();
  try{
    const alias=join(f.installed,"another-hardlink.exe");
    linkSync(f.mainExecutablePath,alias);
    assert.throws(()=>verify(f),/single-link regular/);
    rmSync(alias);
    const foreign=join(f.installed,"foreign.exe");
    writeFileSync(foreign,bytes);
    assert.throws(()=>verify(f,{mainExecutablePath:foreign}),/Only installed fixed Shuvi.exe/);
    writeFileSync(f.witnessPath,"{broken");
    assert.throws(()=>verify(f));
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("M63 real compressed NSIS main receipt flows into production builder and real Windows install gate",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const ps=read("scripts/check-real-nsis-payload.ps1");
  const builder=read("scripts/build-pinned-sha-installer.mjs");
  const runner=read("scripts/windows-m62-real-nsis-install-acceptance.mjs");
  assert.match(ps,/packedMainExeSha256=\(Get-ShuviFileSha256 -LiteralPath \$main\[0\]\.FullName\)/);
  assert.match(ps,/packedMainExeBytes=\[long\]\$main\[0\]\.Length/);
  assert.match(builder,/m63-packed-main-/);
  assert.match(builder,/proven\.packedMainExeSha256/);
  assert.match(builder,/proven\.installerSha256!==manifest\.installerSha256/);
  assert.match(builder,/writeFileSync\(packedMainWitnessPath/);
  assert.match(runner,/verifyPackedMainContent\(\{/);
  assert.match(runner,/actualPackedVsInstalledMainExeVerified:true/);
  assert.match(runner,/verifiedPackedMainExeSha256:verifiedPackedMain\.packedMainExeSha256/);
});
