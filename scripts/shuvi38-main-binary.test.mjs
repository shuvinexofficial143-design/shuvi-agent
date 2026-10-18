import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";

const gate=resolve("scripts/check-shuvi38-main-binary.mjs");
const paths=[
  "src-tauri/Cargo.toml",
  "src-tauri/src/main.rs",
  "src-tauri/src/bin/shuvi-readonly-hash-worker.rs",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.sha-sidecar.conf.json",
];
const sources=Object.fromEntries(paths.map(path=>[path,readFileSync(path,"utf8")]));
const run=mutate=>{
  const root=mkdtempSync(join(tmpdir(),"shuvi38-main-bin-"));
  try{
    const files={...sources};
    mutate?.(files);
    for(const [path,content] of Object.entries(files)){
      const target=join(root,path);
      mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,content);
    }
    return spawnSync(process.execPath,[gate],{
      cwd:root,encoding:"utf8",timeout:15000,shell:false,windowsHide:true,
    });
  }finally{rmSync(root,{recursive:true,force:true});}
};
const fail=(mutate,pattern)=>{
  const result=run(mutate);
  assert.notEqual(result.status,0,result.stdout);
  assert.match(result.stderr,pattern);
};
test("M66 follow-up: real Cargo metadata explicitly selects main Shuvi, sidecar remains externalBin",()=>{
  const result=run();
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/default-run selects Shuvi desktop/);
  assert.match(sources["src-tauri/Cargo.toml"],/^default-run = "shuvi"$/m);
  assert.match(sources["src-tauri/Cargo.toml"],/^required-features = \["sha-worker-build"\]$/m);
  assert.match(sources["src-tauri/Cargo.toml"],/^sha-worker-build = \[\]$/m);
});
test("M66 follow-up: absent default-run cannot regress to arbitrary src/bin target",()=>{
  fail(files=>{files["src-tauri/Cargo.toml"]=files["src-tauri/Cargo.toml"]
    .replace(/^default-run = "shuvi"\n/m,"");},/default-run=shuvi/);
});
test("M66 follow-up: selecting SHA worker as app is prohibited",()=>{
  fail(files=>{files["src-tauri/Cargo.toml"]=files["src-tauri/Cargo.toml"]
    .replace('default-run = "shuvi"','default-run = "shuvi-readonly-hash-worker"');},
    /default-run=shuvi/);
});
test("M66 follow-up: altered desktop entrypoint is rejected",()=>{
  fail(files=>{files["src-tauri/src/main.rs"]="fn main() {}\n";},/desktop entrypoint/);
});
test("M66 follow-up: default Tauri config cannot masquerade worker as main or sidecar",()=>{
  fail(files=>{const p="src-tauri/tauri.conf.json";const x=JSON.parse(files[p]);
    x.mainBinaryName="shuvi-readonly-hash-worker";files[p]=JSON.stringify(x);},
    /mainBinaryName conflicts/);
  fail(files=>{const p="src-tauri/tauri.conf.json";const x=JSON.parse(files[p]);
    x.bundle.externalBin=["binaries/shuvi-readonly-hash-worker"];files[p]=JSON.stringify(x);},
    /configuration must not replace/);
});
test("M66 follow-up: installer overlay cannot drop or substitute the fixed worker",()=>{
  fail(files=>{files["src-tauri/tauri.sha-sidecar.conf.json"]=JSON.stringify(
    {bundle:{externalBin:["binaries/other"]}});},/only the fixed SHA externalBin/);
});
test("M66 NSIS never includes a competing second Cargo worker with the same installed filename",()=>{
  fail(files=>{files["src-tauri/Cargo.toml"]=files["src-tauri/Cargo.toml"]
    .replace('required-features = ["sha-worker-build"]','required-features = []');},
    /feature-gated out of Tauri Cargo binaries/);
  fail(files=>{files["src-tauri/Cargo.toml"]=files["src-tauri/Cargo.toml"]
    .replace('[features]','[features]\ndefault = ["sha-worker-build"]');},
    /feature-gated out of Tauri Cargo binaries/);
  fail(files=>{files["src-tauri/Cargo.toml"]=files["src-tauri/Cargo.toml"]
    .replace('sha-worker-build = []','');},
    /feature-gated out of Tauri Cargo binaries/);
  fail(files=>{files["src-tauri/Cargo.toml"]+='\n[[bin]]\nname = "other"\n';},
    /feature-gated out of Tauri Cargo binaries/);
  fail(files=>{files["src-tauri/Cargo.toml"]=files["src-tauri/Cargo.toml"]
    .replace('name = "shuvi-readonly-hash-worker"','name = "other"');},
    /feature-gated out of Tauri Cargo binaries/);
});

test("M66 pinned Windows worker build is explicit; Tauri production build omits that feature",()=>{
  const prepare=readFileSync("scripts/prepare-native-sha-sidecar.mjs","utf8");
  const builder=readFileSync("scripts/build-pinned-sha-installer.mjs","utf8");
  const workflow=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(prepare,/"--bin","shuvi-readonly-hash-worker","--features","sha-worker-build"/);
  assert.match(workflow,/--bin shuvi-readonly-hash-worker --features sha-worker-build/);
  assert.doesNotMatch(builder,/--features.*sha-worker-build/);
});

test("M66 follow-up: production installer checks binary selection before building any Rust EXE",()=>{
  const scripts=JSON.parse(readFileSync("package.json","utf8")).scripts;
  const cmd=scripts["build:windows-installer"];
  assert.match(cmd,/check-shuvi38-tauri-version-parity\.mjs/);
  assert.match(cmd,/check-shuvi38-main-binary\.mjs/);
  assert.ok(cmd.indexOf("check-shuvi38-main-binary.mjs")<cmd.indexOf("prepare:sha-sidecar"));
  assert.doesNotMatch(readFileSync(gate,"utf8"),/--ignore-version-mismatches|--no-verify/);
});
