import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

const scriptsRoot=resolve("scripts");
const gate=join(scriptsRoot,"check-shuvi38-tauri-version-parity.mjs");
const realPkg=JSON.parse(readFileSync("package.json","utf8"));
const realLock=JSON.parse(readFileSync("package-lock.json","utf8"));
const realCargo=readFileSync("src-tauri/Cargo.lock","utf8");
const currentRust=realCargo.match(/(?:^|\n)\[\[package\]\]\s*\nname = "tauri"\s*\nversion = "(\d+\.\d+\.\d+)"/m)?.[1];
const api=realLock.packages["node_modules/@tauri-apps/api"];

function fixture({crate=currentRust,dependency=api.version,installed=api.version,integrity=api.integrity,packageVersion=api.version}={}){
  const dir=mkdtempSync(join(tmpdir(),"shuvi38-tauri-lock-"));
  mkdirSync(join(dir,"src-tauri"),{recursive:true});
  mkdirSync(join(dir,"node_modules","@tauri-apps","api"),{recursive:true});
  const pkg=structuredClone(realPkg),lock=structuredClone(realLock);
  pkg.dependencies["@tauri-apps/api"]=packageVersion;
  lock.packages[""].dependencies["@tauri-apps/api"]=dependency;
  lock.packages["node_modules/@tauri-apps/api"]={
    ...lock.packages["node_modules/@tauri-apps/api"],
    version:dependency,
    integrity,
    resolved:"https://registry.npmjs.org/@tauri-apps/api/-/api-"+dependency+".tgz",
  };
  writeFileSync(join(dir,"package.json"),JSON.stringify(pkg));
  writeFileSync(join(dir,"package-lock.json"),JSON.stringify(lock));
  writeFileSync(join(dir,"src-tauri","Cargo.lock"),realCargo.replace(
    /(\[\[package\]\]\s*\nname = "tauri"\s*\nversion = ")[^"]+/, "$1"+crate));
  writeFileSync(join(dir,"node_modules","@tauri-apps","api","package.json"),
    JSON.stringify({name:"@tauri-apps/api",version:installed}));
  return dir;
}
const check=dir=>spawnSync(process.execPath,[gate],{
  cwd:dir,encoding:"utf8",timeout:15000,windowsHide:true,shell:false
});
test("M66 actual Rust Tauri, JS manifest, JS lock and published SHA512 match before production build",()=>{
  assert.equal(currentRust,"2.12.2");
  assert.equal(api.version,"2.12.2");
  assert.equal(realPkg.dependencies["@tauri-apps/api"],api.version);
  assert.equal(api.resolved,"https://registry.npmjs.org/@tauri-apps/api/-/api-2.12.2.tgz");
  assert.match(api.integrity,/^sha512-[A-Za-z0-9+/]+=*$/);
  const dir=fixture();
  try {const result=check(dir); assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/Rust Tauri 2\.12\.2, exact npm API 2\.12\.2/);}
  finally{rmSync(dir,{recursive:true,force:true});}
});
test("M66 regression reproduces actual failed NSIS Tauri 2.12/2.11 mismatch",()=>{
  const dir=fixture({dependency:"2.11.1",installed:"2.11.1",packageVersion:"2.11.1"});
  try{const result=check(dir);assert.notEqual(result.status,0);
    assert.match(result.stderr,/mismatches JS API/);}
  finally{rmSync(dir,{recursive:true,force:true});}
});
test("M66 rejects missing or forged npm SHA512 lock before any Rust compilation",()=>{
  for(const integrity of ["","sha256-forged","sha512-invalid@@@"]){
    const dir=fixture({integrity});
    try{const result=check(dir);assert.notEqual(result.status,0);
      assert.match(result.stderr,/exact trusted SHA512-locked dependency/);}
    finally{rmSync(dir,{recursive:true,force:true});}
  }
});
test("M66 rejects stale installed Tauri API even when lock metadata claims 2.12",()=>{
  const dir=fixture({installed:"2.11.1"});
  try{const result=check(dir);assert.notEqual(result.status,0);
    assert.match(result.stderr,/Installed JS API 2\.11\.1 differs/);}
  finally{rmSync(dir,{recursive:true,force:true});}
});
test("M66 rejects JS manifest drift from lock, no silent npm update or version bypass",()=>{
  const dir=fixture({packageVersion:"^2.8.0"});
  try{const result=check(dir);assert.notEqual(result.status,0);}
  finally{rmSync(dir,{recursive:true,force:true});}
  const script=readFileSync(gate,"utf8");
  assert.doesNotMatch(script,/npm\s+install|TAURI_CLI_NO_PKG_CHECK|--ignore-scripts|--no-verify/);
  assert.match(realPkg.scripts["build:windows-installer"],/check-shuvi38-tauri-version-parity\.mjs.*prepare:sha-sidecar/);
});
